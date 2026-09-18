# Deployment Instructions for Render

## Prerequisites

1. GitHub account
2. Render account (free): https://render.com
3. Google Cloud account (for Drive API)

## Step 1: Push to GitHub

```bash
cd server
git init
git add .
git commit -m "Initial commit"
git remote add origin https://github.com/YOUR_USERNAME/id-making-app.git
git push -u origin main
```

## Step 2: Deploy on Render

1. Go to https://render.com and sign up/login
2. Click **New** → **Web Service**
3. Connect your GitHub repository
4. Configure:
   - **Name**: id-making-app
   - **Runtime**: Node
   - **Build Command**: `npm install`
   - **Start Command**: `node server.js`
   - **Plan**: Free
5. Click **Create Web Service**

## Step 3: Environment Variables (on Render)

Go to **Environment** tab and add:

```
NODE_ENV=production
GOOGLE_CLIENT_ID=your_client_id
GOOGLE_CLIENT_SECRET=your_client_secret
GOOGLE_DRIVE_FOLDER_ID=your_folder_id
```

## Step 4: Google Drive Setup

1. Go to https://console.cloud.google.com
2. Create a project or select existing
3. Enable Google Drive API
4. Create credentials (OAuth 2.0 or Service Account)
5. For OAuth:
   - Authorized redirect URIs: `https://your-app.onrender.com/auth/google/callback`
6. For Service Account:
   - Download JSON key
   - Share your Google Drive folder with the service account email

## Step 5: Get Google Drive Folder ID

1. Open your Google Drive
2. Create a folder for IDs (e.g., "Student IDs")
3. Open the folder
4. Copy the ID from URL: `https://drive.google.com/drive/folders/FOLDER_ID_HERE`

## Your App URL

After deployment, your app will be available at:
`https://id-making-app.onrender.com`
