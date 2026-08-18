/**
 * Backup MongoDB Atlas data to the local filesystem.
 *
 * Usage:
 *   node backup-mongodb-atlas.js
 *   node backup-mongodb-atlas.js --out ./mongodb-backups
 *   node backup-mongodb-atlas.js --db ashecontrol
 *   node backup-mongodb-atlas.js --collections telemetry_datas,devices,users
 *
 * Required:
 *   MONGODB_URI must be set in .env or the shell environment.
 */

const fs = require('fs');
const path = require('path');
const { pipeline } = require('stream/promises');
const { Readable } = require('stream');
const zlib = require('zlib');
const mongoose = require('mongoose');

require('dotenv').config({ path: path.join(__dirname, '.env') });

const { EJSON } = mongoose.mongo.BSON;

function getArgValue(name, defaultValue = null) {
  const prefix = `${name}=`;
  const inlineArg = process.argv.find((arg) => arg.startsWith(prefix));
  if (inlineArg) return inlineArg.slice(prefix.length);

  const index = process.argv.indexOf(name);
  if (index !== -1 && process.argv[index + 1]) return process.argv[index + 1];

  return defaultValue;
}

function hasArg(name) {
  return process.argv.includes(name);
}

function printHelp() {
  console.log(`
MongoDB Atlas local backup

Usage:
  node backup-mongodb-atlas.js [options]

Options:
  --out <dir>                 Backup root directory. Default: ./mongodb-backups
  --db <name>                 Database to backup. Default: MONGODB_DATABASE, URI db, or ashecontrol.
  --collections <a,b,c>       Comma-separated collection names to export.
  --batch-size <number>       Mongo cursor batch size. Default: 1000
  --plain-json                Write .ndjson files instead of .ndjson.gz files.
  --list-databases            Print database names and sizes without exporting data.
  --stats-only                Print collection counts/sizes without exporting data.
  --help                      Show this help.

Environment:
  MONGODB_URI                 Atlas connection string. Required.
  MONGODB_DATABASE            Optional database name override.
`);
}

function safeName(value) {
  return String(value || 'unknown')
    .replace(/[^a-zA-Z0-9._-]+/g, '_')
    .replace(/^_+|_+$/g, '') || 'unknown';
}

function redactUri(uri) {
  return uri.replace(/\/\/([^:/?#]+):([^@/?#]+)@/, '//<user>:<password>@');
}

function getUriDatabaseName(uri) {
  try {
    const parsed = new URL(uri);
    return parsed.pathname.replace(/^\//, '') || null;
  } catch (error) {
    return null;
  }
}

function formatBytes(bytes) {
  if (!Number.isFinite(bytes)) return 'unknown';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let value = bytes;
  let unitIndex = 0;

  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }

  return `${value.toFixed(value >= 10 || unitIndex === 0 ? 0 : 1)} ${units[unitIndex]}`;
}

async function writeJson(filePath, value) {
  await fs.promises.writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

async function getCollectionStats(db, collectionName) {
  try {
    const stats = await db.command({ collStats: collectionName });
    return {
      count: stats.count,
      size: stats.size,
      storageSize: stats.storageSize,
      totalIndexSize: stats.totalIndexSize,
    };
  } catch (error) {
    return {
      count: null,
      size: null,
      storageSize: null,
      totalIndexSize: null,
      error: error.message,
    };
  }
}

async function exportCollection(collection, outputFile, options) {
  const cursor = collection.find({}, { batchSize: options.batchSize });
  let exportedCount = 0;

  async function* documentsToLines() {
    for await (const document of cursor) {
      exportedCount += 1;
      yield `${EJSON.stringify(document, { relaxed: false })}\n`;
    }
  }

  const streams = [Readable.from(documentsToLines())];
  if (options.gzip) streams.push(zlib.createGzip({ level: zlib.constants.Z_BEST_SPEED }));
  streams.push(fs.createWriteStream(outputFile));

  await pipeline(...streams);

  const stats = await fs.promises.stat(outputFile);
  return {
    documentsExported: exportedCount,
    file: path.basename(outputFile),
    bytes: stats.size,
  };
}

async function backupMongoDBAtlas() {
  if (hasArg('--help') || hasArg('-h')) {
    printHelp();
    return;
  }

  const mongoUri = process.env.MONGODB_URI;
  if (!mongoUri) {
    throw new Error('MONGODB_URI is required. Add it to .env or export it before running this script.');
  }

  const uriDatabase = getUriDatabaseName(mongoUri);
  const databaseName = getArgValue('--db', process.env.MONGODB_DATABASE || uriDatabase || 'ashecontrol');
  const backupRoot = path.resolve(getArgValue('--out', path.join(__dirname, 'mongodb-backups')));
  const requestedCollections = getArgValue('--collections');
  const batchSize = Number.parseInt(getArgValue('--batch-size', '1000'), 10);
  const gzip = !hasArg('--plain-json');
  const statsOnly = hasArg('--stats-only');
  const listDatabases = hasArg('--list-databases');

  if (!Number.isInteger(batchSize) || batchSize <= 0) {
    throw new Error('--batch-size must be a positive integer.');
  }

  console.log('\n' + '='.repeat(80));
  console.log('MongoDB Atlas local backup');
  console.log('='.repeat(80));
  console.log(`Connection: ${redactUri(mongoUri)}`);
  if (!uriDatabase && !process.env.MONGODB_DATABASE && !getArgValue('--db')) {
    console.log('No database was present in MONGODB_URI; using project default database: ashecontrol');
  }

  await mongoose.connect(mongoUri, {
    dbName: listDatabases ? 'admin' : databaseName,
    serverSelectionTimeoutMS: 15000,
    socketTimeoutMS: 45000,
  });

  const db = mongoose.connection.db;

  if (listDatabases) {
    const admin = db.admin();
    const result = await admin.listDatabases();

    console.log('\nDatabases on this cluster:');
    result.databases
      .sort((a, b) => b.sizeOnDisk - a.sizeOnDisk)
      .forEach((database) => {
        console.log(`  ${database.name}: ${formatBytes(database.sizeOnDisk)}${database.empty ? ' (empty)' : ''}`);
      });

    return;
  }

  const dbName = db.databaseName;
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const backupDir = path.join(backupRoot, `${safeName(dbName)}-${timestamp}`);

  await fs.promises.mkdir(backupDir, { recursive: true });

  console.log(`Database: ${dbName}`);
  console.log(`Backup directory: ${backupDir}`);

  const allCollections = await db.listCollections({}, { nameOnly: true }).toArray();
  const availableNames = allCollections.map((collection) => collection.name).sort();
  const selectedNames = requestedCollections
    ? requestedCollections.split(',').map((name) => name.trim()).filter(Boolean)
    : availableNames;

  const missingCollections = selectedNames.filter((name) => !availableNames.includes(name));
  if (missingCollections.length > 0) {
    throw new Error(`Collection(s) not found: ${missingCollections.join(', ')}`);
  }

  const manifest = {
    createdAt: new Date().toISOString(),
    database: dbName,
    requestedDatabase: databaseName,
    uriDatabase: uriDatabase || null,
    sourceHost: mongoose.connection.host,
    format: gzip ? 'MongoDB Extended JSON NDJSON gzip' : 'MongoDB Extended JSON NDJSON',
    restoreNote: 'Each line is one BSON-preserving Extended JSON document. Use EJSON.parse(line) when restoring.',
    collections: [],
  };

  const indexes = {};

  console.log(`Collections to backup: ${selectedNames.length}`);

  for (const collectionName of selectedNames) {
    const collection = db.collection(collectionName);
    const stats = await getCollectionStats(db, collectionName);
    const documentCount = stats.count == null ? await collection.estimatedDocumentCount() : stats.count;

    console.log(
      `\n${collectionName}: ${documentCount} documents, data ${formatBytes(stats.size)}, storage ${formatBytes(stats.storageSize)}`
    );

    if (statsOnly) {
      manifest.collections.push({
        name: collectionName,
        documentsExpected: documentCount,
        dataBytes: stats.size,
        storageBytes: stats.storageSize,
        indexBytes: stats.totalIndexSize,
        statsError: stats.error,
      });
      continue;
    }

    const fileName = `${safeName(collectionName)}.ndjson${gzip ? '.gz' : ''}`;
    const outputFile = path.join(backupDir, fileName);

    console.log(`Backing up ${collectionName}...`);
    const result = await exportCollection(collection, outputFile, { batchSize, gzip });
    const collectionIndexes = await collection.indexes();

    indexes[collectionName] = collectionIndexes;
    manifest.collections.push({
      name: collectionName,
      documentsExpected: documentCount,
      documentsExported: result.documentsExported,
      file: result.file,
      bytes: result.bytes,
      dataBytes: stats.size,
      storageBytes: stats.storageSize,
      indexBytes: stats.totalIndexSize,
      indexes: collectionIndexes.length,
    });

    console.log(`Saved ${result.documentsExported} documents to ${result.file}`);
  }

  await writeJson(path.join(backupDir, 'indexes.json'), indexes);
  await writeJson(path.join(backupDir, 'manifest.json'), manifest);

  console.log('\n' + '='.repeat(80));
  console.log(statsOnly ? 'Stats complete' : 'Backup complete');
  console.log('='.repeat(80));
  console.log(`Backup directory: ${backupDir}`);
  console.log(`Manifest: ${path.join(backupDir, 'manifest.json')}`);
}

backupMongoDBAtlas()
  .catch((error) => {
    console.error('\nBackup failed:', error.message);
    process.exitCode = 1;
  })
  .finally(async () => {
    try {
      await mongoose.connection.close();
    } catch (error) {
      // Ignore close errors during shutdown.
    }
  });
