# Deploying the BACKEND to Render (step-by-step)

This file contains copy-paste commands and the checklist I used to prepare the repository for Render.

1) Create a GitHub repository (if you haven't already)

- On GitHub create a new repo named `ZEPTAC-DEMO-BACKEND` (or whatever you prefer).

2) Add the remote to your local repository and push the `BACKEND` code

From `D:\ASHECONTROL\frontend\ZEPTAC-IOT-PLATFORM\BACKEND` run (PowerShell):

```powershell
# from workspace root (recommended)
cd D:\ASHECONTROL\frontend\ZEPTAC-IOT-PLATFORM

# Create a dedicated branch or push main (this example pushes main)
git remote add origin https://github.com/Haru65/ZEPTAC-DEMO-BACKEND.git
git branch -M main
git push -u origin main
```

If the remote already exists, update it instead:

```powershell
git remote set-url origin https://github.com/Haru65/ZEPTAC-DEMO-BACKEND.git
git push -u origin main
```

3) Configure Render

- Go to https://dashboard.render.com and sign in. Connect your GitHub account and grant access to the `ZEPTAC-DEMO-BACKEND` repo.
- Create a new Web Service.
  - Connect the `ZEPTAC-DEMO-BACKEND` repository.
  - Branch: `main`
  - Root: `BACKEND` (important — the backend code lives in the `BACKEND` folder)
  - Environment: `Node` (choose the node environment matching your runtime)
  - Build command: `npm install`
  - Start command: `npm start`
  - Port: Render will use `PORT` from environment; we default to 3001 in code if unset.

4) Set Environment Variables on Render (required)

At minimum set:

- `MONGODB_URI` = your Atlas connection string (e.g. mongodb+srv://<user>:<pass>@cluster0.dpt6dxy.mongodb.net/<dbname>?retryWrites=true&w=majority)
- `PORT` = 3001 (optional; Render sets this automatically, but you can set it)
- `FRONTEND_URLS` = comma-separated allowed origins for CORS (e.g. https://your-frontend-url, http://localhost:5173)

Optional / recommended:

- `JWT_SECRET` = (your JWT secret)
- `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASSWORD` (email sending)
- `MQTT_BROKER_URL`, `MQTT_USERNAME`, `MQTT_PASSWORD`, `MQTT_DEVICE_ID` (if your MQTT broker requires credentials)
- Any other variables listed in `BACKEND/.env.example`

5) Deploy

- After configuration save, click "Create Service" / "Deploy".
- Watch the build logs in Render. If `npm install` succeeds and `npm start` executes, you should see the server logs.

6) Verify connection to MongoDB

- In the Render logs you should see `✅ MongoDB connected successfully` coming from `BACKEND/config/database.js` after the app starts.
- If you don't see that, check the `MONGODB_URI` value for typos and that Atlas allows connections from Render (update IP access list or use 0.0.0.0/0 if appropriate for testing).

7) Security note

- Do NOT commit your `MONGODB_URI` or other secrets to git. Use Render environment variables.
- If you shared the Atlas URI publicly earlier, rotate the DB user's password or create a new DB user.

Troubleshooting tips

- If you get CORS errors, add the frontend origin to `FRONTEND_URLS` env var and redeploy.
- If the app cannot reach MQTT broker, verify `MQTT_BROKER_URL` and MQTT credentials in Render env.
- Check Render's service health checks if the service isn't staying up.

If you want, I can:

- Add the `render.yaml` (already added) so the service can be created from repo using the render.yaml file.
- Show the exact `git` commands to push only the `BACKEND` folder into a new repo (if you prefer the repo to contain only backend code).
- Attempt to run a syntax check on the `BACKEND` entrypoint locally (non-networking) to verify no parse errors.
