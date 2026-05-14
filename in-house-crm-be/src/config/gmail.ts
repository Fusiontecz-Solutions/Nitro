import { google } from 'googleapis';
import dotenv from 'dotenv';

dotenv.config();

const oAuth2Client = new google.auth.OAuth2(
  process.env.GOOGLE_CLIENT_ID,
  process.env.GOOGLE_CLIENT_SECRET,
  // "http://localhost:4000/api/v1/google/callback"

  process.env.GOOGLE_REDIRECT_URI || "https://www.barclays.finexusai.com/backend/api/v1"
);

// Set credentials using REFRESH TOKEN
oAuth2Client.setCredentials({
  refresh_token: process.env.GOOGLE_REFRESH_TOKEN,
});

export default oAuth2Client; 