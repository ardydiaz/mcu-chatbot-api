const express = require('express');
const { register, login, microsoftLogin } = require('../controllers/authController');

const router = express.Router();

/**
 * @swagger
 * /api/auth/register:
 *   post:
 *     summary: Register a new user
 *     tags:
 *       - Auth
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - name
 *               - email
 *               - password
 *             properties:
 *               name:
 *                 type: string
 *                 example: Admin User
 *               email:
 *                 type: string
 *                 example: adminmcu@mcu.edu.ph
 *               password:
 *                 type: string
 *                 example: adminmcu@#*11
 *               role:
 *                 type: string
 *                 enum: [admin]
 *                 example: admin
 *     responses:
 *       201:
 *         description: User registered successfully
 */
router.post('/register', register);

/**
 * @swagger
 * /api/auth/login:
 *   post:
 *     summary: Login user
 *     tags:
 *       - Auth
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - email
 *               - password
 *             properties:
 *               email:
 *                 type: string
 *                 example: adminmcu@mcu.edu.ph
 *               password:
 *                 type: string
 *                 example: adminmcu@#*11
 *     responses:
 *       200:
 *         description: Login successful
 */
router.post('/login', login);

/**
 * @swagger
 * /api/auth/microsoft:
 *   post:
 *     summary: Login or register using Microsoft 365 SSO
 *     tags:
 *       - Auth
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - idToken
 *             properties:
 *               idToken:
 *                 type: string
 *                 description: Microsoft Entra ID token from MSAL React
 *                 example: eyJ0eXAiOiJKV1QiLCJhbGciOiJSUzI1NiIs...
 *               purpose:
 *                 type: string
 *                 enum:
 *                   - admin
 *                   - chat
 *                 description: Use admin for admin portal login and chat for chatbot guest-limit login.
 *                 example: chat
 *               graphAccessToken:
 *                 type: string
 *                 description: Optional Microsoft Graph access token with User.Read permission. Used only to fetch the user's profile photo.
 *                 example: eyJ0eXAiOiJKV1QiLCJub25jZSI6...
 *     responses:
 *       200:
 *         description: Microsoft login successful
 */
router.post('/microsoft', microsoftLogin);

module.exports = router;
