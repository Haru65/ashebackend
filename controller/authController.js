const User = require('../models/user');
const jwt = require('jsonwebtoken');
const Joi = require('joi');

// Rate limiting for failed login attempts
const loginAttempts = new Map();
const MAX_LOGIN_ATTEMPTS = 5;
const LOCKOUT_TIME = 15 * 60 * 1000; // 15 minutes

// Helper function to check and update login attempts
function checkLoginAttempts(identifier) {
  const now = Date.now();
  const attempts = loginAttempts.get(identifier) || { count: 0, lastAttempt: 0, lockedUntil: 0 };
  
  // Reset attempts if lockout time has passed
  if (attempts.lockedUntil && now > attempts.lockedUntil) {
    attempts.count = 0;
    attempts.lockedUntil = 0;
  }
  
  return attempts;
}

function recordFailedAttempt(identifier) {
  const now = Date.now();
  const attempts = loginAttempts.get(identifier) || { count: 0, lastAttempt: 0, lockedUntil: 0 };
  
  attempts.count += 1;
  attempts.lastAttempt = now;
  
  if (attempts.count >= MAX_LOGIN_ATTEMPTS) {
    attempts.lockedUntil = now + LOCKOUT_TIME;
  }
  
  loginAttempts.set(identifier, attempts);
  return attempts;
}

function clearLoginAttempts(identifier) {
  loginAttempts.delete(identifier);
}

// Validation schemas
const registerSchema = Joi.object({
  username: Joi.string().min(3).max(50).required(),
  email: Joi.string().email().required(),
  password: Joi.string().min(6).required(),
  role: Joi.string().valid('admin', 'operator', 'viewer').default('viewer')
});

const loginSchema = Joi.object({
  username: Joi.string().required(),
  password: Joi.string().required()
});

class AuthController {
  // Register new user
  static async register(req, res) {
    try {
      const { error, value } = registerSchema.validate(req.body);
      if (error) {
        return res.status(400).json({
          success: false,
          error: error.details[0].message
        });
      }

      const { username, email, password, role } = value;

      // Check if user already exists
      const existingUser = await User.findOne({
        $or: [{ username }, { email }]
      });

      if (existingUser) {
        return res.status(409).json({
          success: false,
          error: 'Username or email already exists'
        });
      }

      // Create new user
      const user = new User({ username, email, password, role });
      await user.save();

      // Generate tokens
      const { accessToken, refreshToken } = user.generateTokens();

      // Save refresh token
      user.refreshTokens.push({ token: refreshToken });
      await user.save();

      res.status(201).json({
        success: true,
        message: 'User registered successfully',
        data: {
          user: {
            id: user._id,
            username: user.username,
            email: user.email,
            role: user.role,
            permissions: user.permissions
          },
          accessToken,
          refreshToken
        }
      });

    } catch (error) {
      console.error('Registration error:', error);
      res.status(500).json({
        success: false,
        error: 'Internal server error'
      });
    }
  }

  // Login user
  static async login(req, res) {
    try {
      // Validate request body
      const { error, value } = loginSchema.validate(req.body);
      if (error) {
        return res.status(400).json({
          success: false,
          error: 'Please provide valid email/username and password'
        });
      }

      const { username, password } = value;
      const clientIP = req.ip || req.connection.remoteAddress;
      const identifier = `${username.toLowerCase()}_${clientIP}`;

      // Check for rate limiting
      const attempts = checkLoginAttempts(identifier);
      if (attempts.lockedUntil && Date.now() < attempts.lockedUntil) {
        const remainingTime = Math.ceil((attempts.lockedUntil - Date.now()) / 60000);
        return res.status(429).json({
          success: false,
          error: `Too many attempts. Try again in ${remainingTime} minute(s)`
        });
      }

      // Find user
      const user = await User.findOne({
        $or: [{ username }, { email: username }],
        isActive: true
      });

      if (!user) {
        // Record failed attempt for non-existent user
        recordFailedAttempt(identifier);
        return res.status(401).json({
          success: false,
          error: 'User not found'
        });
      }

      // Check if user account is locked
      if (user.accountLocked && user.lockedUntil && new Date() < user.lockedUntil) {
        const remainingMinutes = Math.ceil((user.lockedUntil - new Date()) / 60000);
        return res.status(401).json({
          success: false,
          error: `Account locked. Try again in ${remainingMinutes} minute(s)`
        });
      }

      // Check password
      const isValidPassword = await user.comparePassword(password);
      if (!isValidPassword) {
        console.log('❌ Password validation failed for user:', username);
        
        // Record failed attempt
        const failedAttempts = recordFailedAttempt(identifier);
        
        // Update user's failed login attempts
        user.failedLoginAttempts = (user.failedLoginAttempts || 0) + 1;
        user.lastFailedLogin = new Date();
        
        // Lock account if too many failed attempts
        if (user.failedLoginAttempts >= MAX_LOGIN_ATTEMPTS) {
          user.accountLocked = true;
          user.lockedUntil = new Date(Date.now() + LOCKOUT_TIME);
        }
        
        await user.save();
        
        const errorResponse = {
          success: false,
          error: 'Password is wrong'
        };
        
        console.log('📤 Sending error response:', errorResponse);
        return res.status(401).json(errorResponse);
      }

      // Clear login attempts on successful login
      clearLoginAttempts(identifier);
      
      // Reset user's failed login attempts
      if (user.failedLoginAttempts > 0) {
        user.failedLoginAttempts = 0;
        user.accountLocked = false;
        user.lockedUntil = null;
      }

      // Generate tokens
      const { accessToken, refreshToken } = user.generateTokens();

      // Save refresh token and update last login
      user.refreshTokens.push({ token: refreshToken });
      user.lastLogin = new Date();
      await user.save();

      res.json({
        success: true,
        message: 'Login successful',
        data: {
          user: {
            id: user._id,
            username: user.username,
            email: user.email,
            role: user.role,
            permissions: user.permissions
          },
          accessToken,
          refreshToken
        }
      });

    } catch (error) {
      console.error('Login error:', error);
      
      // Handle specific database errors
      if (error.name === 'ValidationError') {
        return res.status(400).json({
          success: false,
          error: 'Please provide valid login credentials.',
          type: 'VALIDATION_ERROR'
        });
      }
      
      if (error.name === 'MongoError' || error.name === 'MongooseError') {
        return res.status(503).json({
          success: false,
          error: 'Database temporarily unavailable. Please try again in a few moments.',
          type: 'DATABASE_ERROR'
        });
      }
      
      res.status(500).json({
        success: false,
        error: 'Something went wrong on our end. Please try again later or contact support if the issue persists.',
        type: 'INTERNAL_ERROR'
      });
    }
  }

  // Refresh access token
  static async refreshToken(req, res) {
    try {
      const { refreshToken } = req.body;

      if (!refreshToken) {
        return res.status(401).json({
          success: false,
          error: 'Refresh token required'
        });
      }

      // Verify refresh token
      const decoded = jwt.verify(refreshToken, process.env.JWT_REFRESH_SECRET || 'your-refresh-secret');
      
      // Find user and check if refresh token exists
      const user = await User.findOne({
        _id: decoded.userId,
        'refreshTokens.token': refreshToken,
        isActive: true
      });

      if (!user) {
        return res.status(401).json({
          success: false,
          error: 'Invalid refresh token'
        });
      }

      // Generate new tokens
      const tokens = user.generateTokens();

      // Remove old refresh token and add new one
      user.refreshTokens = user.refreshTokens.filter(rt => rt.token !== refreshToken);
      user.refreshTokens.push({ token: tokens.refreshToken });
      await user.save();

      res.json({
        success: true,
        data: {
          accessToken: tokens.accessToken,
          refreshToken: tokens.refreshToken
        }
      });

    } catch (error) {
      console.error('Refresh token error:', error);
      res.status(401).json({
        success: false,
        error: 'Invalid refresh token'
      });
    }
  }

  // Logout user
  static async logout(req, res) {
    try {
      const { refreshToken } = req.body;
      const user = req.user;

      if (refreshToken) {
        // Remove specific refresh token
        await User.findByIdAndUpdate(user.userId, {
          $pull: { refreshTokens: { token: refreshToken } }
        });
      }

      res.json({
        success: true,
        message: 'Logged out successfully'
      });

    } catch (error) {
      console.error('Logout error:', error);
      res.status(500).json({
        success: false,
        error: 'Internal server error'
      });
    }
  }

  // Get current user profile
  static async getProfile(req, res) {
    try {
      const user = await User.findById(req.user.userId).select('-password -refreshTokens');
      
      res.json({
        success: true,
        data: { user }
      });

    } catch (error) {
      console.error('Get profile error:', error);
      res.status(500).json({
        success: false,
        error: 'Internal server error'
      });
    }
  }
}

module.exports = AuthController;