# ProjFlow – Project Management Tool

## About the Project
ProjFlow is a collaborative project management application designed to help users organize projects, create and assign tasks, track progress, and communicate through task comments.

## Features
- User registration and login
- Project creation and management
- Task creation and assignment
- Task status tracking: Todo, In Progress, and Done
- Task comments and collaboration
- MongoDB database integration
- Socket.IO support for real-time communication

## Technologies Used
- **Frontend:** HTML, CSS, JavaScript
- **Backend:** Node.js, Express.js
- **Database:** MongoDB
- **Real-time Communication:** Socket.IO
- **Authentication:** bcryptjs and JSON Web Tokens (JWT)

## Installation and Setup

1. Clone the repository:
   ```bash
   git clone https://github.com/yuvyuvrajsingh98632-art/ProjFlow-Project-Management-Tool.git
   ```

2. Open the project folder:
   ```bash
   cd ProjFlow-Project-Management-Tool
   ```

3. Install dependencies:
   ```bash
   npm install
   ```

4. Configure environment variables in a `.env` file. Add the MongoDB connection string and any required authentication secret according to the server configuration.

5. Start the server:
   ```bash
   npm start
   ```

6. Open `http://localhost:5000` in your browser.

## Project Structure
- `server.js` – Express server and API routes
- `public/index.html` – Main web interface
- `public/style.css` – Application styling
- `public/app.js` – Frontend functionality
- `package.json` – Project dependencies and scripts

## Purpose
This project was developed as part of an internship task to demonstrate project management, task tracking, backend API development, database integration, and collaborative application development.
