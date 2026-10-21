
const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const mongoose = require("mongoose");
const cors = require("cors");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const path = require("path");
require("dotenv").config();

const app = express();
const server = http.createServer(app);

const io = new Server(server, {
  cors: { origin: "*" }
});

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

const PORT = process.env.PORT || 5000;
const MONGO_URI =
  process.env.MONGO_URI ||
  "mongodb://127.0.0.1:27017/project_management_tool";

const JWT_SECRET = process.env.JWT_SECRET || "change_this_dev_secret";

// -------------------- DATABASE MODELS --------------------

const userSchema = new mongoose.Schema(
  {
    username: { type: String, required: true, trim: true },
    email: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true
    },
    password: { type: String, required: true }
  },
  { timestamps: true }
);

const User = mongoose.model("User", userSchema);

const projectSchema = new mongoose.Schema(
  {
    title: { type: String, required: true, trim: true },
    description: { type: String, default: "" },
    owner: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    members: [{ type: mongoose.Schema.Types.ObjectId, ref: "User" }]
  },
  { timestamps: true }
);

const Project = mongoose.model("Project", projectSchema);

const commentSchema = new mongoose.Schema({
  author: { type: String, required: true },
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "User",
    default: null
  },
  text: { type: String, required: true, trim: true },
  createdAt: { type: Date, default: Date.now }
});

const taskSchema = new mongoose.Schema(
  {
    title: { type: String, required: true, trim: true },
    description: { type: String, default: "" },
    status: {
      type: String,
      enum: ["Todo", "In Progress", "Done"],
      default: "Todo"
    },
    assignedTo: { type: String, default: "Unassigned" },
    assignedToId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null
    },
    project: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Project",
      required: true
    },
    comments: [commentSchema]
  },
  { timestamps: true }
);

const Task = mongoose.model("Task", taskSchema);

const notificationSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true
    },
    message: { type: String, required: true },
    projectId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Project",
      default: null
    },
    taskId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Task",
      default: null
    },
    read: { type: Boolean, default: false }
  },
  { timestamps: true }
);

const Notification = mongoose.model("Notification", notificationSchema);

// -------------------- HELPERS --------------------

function createToken(user) {
  return jwt.sign(
    { userId: user._id.toString(), email: user.email },
    JWT_SECRET,
    { expiresIn: "7d" }
  );
}

async function notifyUser(userId, message, projectId, taskId) {
  if (!userId || !mongoose.isValidObjectId(userId)) return;

  const notification = await Notification.create({
    userId,
    message,
    projectId: projectId || null,
    taskId: taskId || null
  });

  io.to(`user:${userId}`).emit("notification", notification);
}

function handleError(res, error, status = 400) {
  console.error(error);
  if (error.code === 11000) {
    return res.status(409).json({
      error: "Email already registered."
    });
  }

  if (error.name === "ValidationError") {
    return res.status(400).json({ error: error.message });
  }

  if (error.name === "CastError") {
    return res.status(400).json({ error: "Invalid ID supplied." });
  }

  return res.status(status).json({
    error: error.message || "Something went wrong."
  });
}

// Optional authentication middleware for future protected routes.
function authenticateToken(req, res, next) {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : null;

  if (!token) {
    return res.status(401).json({ error: "Authentication token required." });
  }

  try {
    req.user = jwt.verify(token, JWT_SECRET);
    next();
  } catch {
    return res.status(401).json({ error: "Invalid or expired token." });
  }
}

// -------------------- HEALTH CHECK --------------------

app.get("/api/health", (req, res) => {
  res.json({
    status: "OK",
    database: mongoose.connection.readyState === 1 ? "connected" : "disconnected"
  });
});

// -------------------- AUTH ROUTES --------------------

app.post("/api/auth/register", async (req, res) => {
  try {
    const { username, email, password } = req.body;

    if (!username || !email || !password) {
      return res.status(400).json({
        error: "Username, email and password are required."
      });
    }

    if (String(password).length < 6) {
      return res.status(400).json({
        error: "Password must be at least 6 characters."
      });
    }

    const normalizedEmail = String(email).trim().toLowerCase();

    const existingUser = await User.findOne({ email: normalizedEmail });
    if (existingUser) {
      return res.status(409).json({ error: "Email already registered." });
    }

    const hashedPassword = await bcrypt.hash(password, 10);

    const user = await User.create({
      username: String(username).trim(),
      email: normalizedEmail,
      password: hashedPassword
    });

    res.status(201).json({
      message: "User registered successfully.",
      username: user.username,
      userId: user._id,
      token: createToken(user)
    });
  } catch (error) {
    handleError(res, error);
  }
});

app.post("/api/auth/login", async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({
        error: "Email and password are required."
      });
    }

    const user = await User.findOne({
      email: String(email).trim().toLowerCase()
    });

    if (!user || !(await bcrypt.compare(password, user.password))) {
      return res.status(401).json({
        error: "Invalid email or password."
      });
    }

    res.json({
      username: user.username,
      userId: user._id,
      token: createToken(user)
    });
  } catch (error) {
    handleError(res, error, 500);
  }
});

// Return current user profile using a JWT.
app.get("/api/auth/me", authenticateToken, async (req, res) => {
  try {
    const user = await User.findById(req.user.userId)
      .select("_id username email");

    if (!user) {
      return res.status(404).json({ error: "User not found." });
    }

    res.json(user);
  } catch (error) {
    handleError(res, error, 500);
  }
});

// -------------------- PROJECT ROUTES --------------------

app.get("/api/projects", async (req, res) => {
  try {
    const projects = await Project.find()
      .populate("owner", "username email")
      .populate("members", "username email")
      .sort({ createdAt: -1 });

    res.json(projects);
  } catch (error) {
    handleError(res, error, 500);
  }
});

app.post("/api/projects", async (req, res) => {
  try {
    const { title, description, userId, ownerId } = req.body;

    if (!title || !String(title).trim()) {
      return res.status(400).json({ error: "Project title is required." });
    }

    const requestedOwner = ownerId || userId;
    let owner = null;

    if (requestedOwner) {
      if (!mongoose.isValidObjectId(requestedOwner)) {
        return res.status(400).json({ error: "Invalid owner ID." });
      }

      owner = await User.findById(requestedOwner);
      if (!owner) {
        return res.status(404).json({ error: "Project owner not found." });
      }
    }

    const project = await Project.create({
      title: String(title).trim(),
      description: description || "",
      owner: owner ? owner._id : null,
      members: owner ? [owner._id] : []
    });

    const populatedProject = await Project.findById(project._id)
      .populate("owner", "username email")
      .populate("members", "username email");

    res.status(201).json(populatedProject);
  } catch (error) {
    handleError(res, error);
  }
});

app.get("/api/projects/:id", async (req, res) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) {
      return res.status(400).json({ error: "Invalid project ID." });
    }

    const project = await Project.findById(req.params.id)
      .populate("owner", "username email")
      .populate("members", "username email");

    if (!project) {
      return res.status(404).json({ error: "Project not found." });
    }

    const tasks = await Task.find({ project: project._id })
      .populate("assignedToId", "username email")
      .sort({ createdAt: -1 });

    res.json({ project, tasks });
  } catch (error) {
    handleError(res, error, 500);
  }
});

// Add a user to a project team.
app.post("/api/projects/:id/members", async (req, res) => {
  try {
    const { userId } = req.body;

    if (
      !mongoose.isValidObjectId(req.params.id) ||
      !mongoose.isValidObjectId(userId)
    ) {
      return res.status(400).json({ error: "Valid project ID and user ID required." });
    }

    const [project, user] = await Promise.all([
      Project.findById(req.params.id),
      User.findById(userId)
    ]);

    if (!project) {
      return res.status(404).json({ error: "Project not found." });
    }

    if (!user) {
      return res.status(404).json({ error: "User not found." });
    }

    if (!project.members.some(id => id.toString() === user._id.toString())) {
      project.members.push(user._id);
      await project.save();
    }

    const updatedProject = await Project.findById(project._id)
      .populate("owner", "username email")
      .populate("members", "username email");

    io.to(project._id.toString()).emit("project_update", updatedProject);

    res.json(updatedProject);
  } catch (error) {
    handleError(res, error);
  }
});

// -------------------- TASK ROUTES --------------------

app.post("/api/tasks", async (req, res) => {
  try {
    const {
      title,
      description,
      projectId,
      status,
      assignedTo,
      assignedToId
    } = req.body;

    if (!title || !String(title).trim() || !projectId) {
      return res.status(400).json({
        error: "Task title and project ID are required."
      });
    }

    if (!mongoose.isValidObjectId(projectId)) {
      return res.status(400).json({ error: "Invalid project ID." });
    }

    const project = await Project.findById(projectId);
    if (!project) {
      return res.status(404).json({ error: "Project not found." });
    }

    const allowedStatuses = ["Todo", "In Progress", "Done"];
    if (status && !allowedStatuses.includes(status)) {
      return res.status(400).json({ error: "Invalid task status." });
    }

    let assigneeId = null;
    let assigneeName = assignedTo || "Unassigned";

    if (assignedToId) {
      if (!mongoose.isValidObjectId(assignedToId)) {
        return res.status(400).json({ error: "Invalid assignee ID." });
      }

      const user = await User.findById(assignedToId);
      if (!user) {
        return res.status(404).json({ error: "Assignee not found." });
      }

      assigneeId = user._id;
      assigneeName = user.username;
    }

    const task = await Task.create({
      title: String(title).trim(),
      description: description || "",
      project: project._id,
      status: status || "Todo",
      assignedTo: assigneeName,
      assignedToId: assigneeId
    });

    const populatedTask = await Task.findById(task._id)
      .populate("assignedToId", "username email");

    io.to(project._id.toString()).emit("task_update", populatedTask);

    if (assigneeId) {
      await notifyUser(
        assigneeId,
        `You were assigned a task: ${task.title}`,
        project._id,
        task._id
      );
    }

    res.status(201).json(populatedTask);
  } catch (error) {
    handleError(res, error);
  }
});

app.put("/api/tasks/:id", async (req, res) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) {
      return res.status(400).json({ error: "Invalid task ID." });
    }

    const task = await Task.findById(req.params.id);

    if (!task) {
      return res.status(404).json({ error: "Task not found." });
    }

    const { status, title, description, assignedTo, assignedToId } = req.body;
    const allowedStatuses = ["Todo", "In Progress", "Done"];

    if (status !== undefined) {
      if (!allowedStatuses.includes(status)) {
        return res.status(400).json({ error: "Invalid task status." });
      }
      task.status = status;
    }

    if (title !== undefined) task.title = String(title).trim();
    if (description !== undefined) task.description = description;

    if (assignedToId !== undefined) {
      if (assignedToId === null || assignedToId === "") {
        task.assignedToId = null;
        task.assignedTo = "Unassigned";
      } else {
        if (!mongoose.isValidObjectId(assignedToId)) {
          return res.status(400).json({ error: "Invalid assignee ID." });
        }

        const user = await User.findById(assignedToId);
        if (!user) {
          return res.status(404).json({ error: "Assignee not found." });
        }

        task.assignedToId = user._id;
        task.assignedTo = user.username;
      }
    } else if (assignedTo !== undefined) {
      task.assignedTo = assignedTo || "Unassigned";
    }

    await task.save();

    const populatedTask = await Task.findById(task._id)
      .populate("assignedToId", "username email");

    io.to(task.project.toString()).emit("task_update", populatedTask);

    if (task.assignedToId) {
      await notifyUser(
        task.assignedToId,
        `Task updated: ${task.title}`,
        task.project,
        task._id
      );
    }

    res.json(populatedTask);
  } catch (error) {
    handleError(res, error);
  }
});

// -------------------- COMMENTS --------------------

app.post("/api/tasks/:id/comments", async (req, res) => {
  try {
    const { author, text: commentText, userId } = req.body;

    if (!commentText || !String(commentText).trim()) {
      return res.status(400).json({ error: "Comment text is required." });
    }

    if (!mongoose.isValidObjectId(req.params.id)) {
      return res.status(400).json({ error: "Invalid task ID." });
    }

    const task = await Task.findById(req.params.id);

    if (!task) {
      return res.status(404).json({ error: "Task not found." });
    }

    let commentAuthor = author || "User";
    let commentUserId = null;

    if (userId) {
      if (!mongoose.isValidObjectId(userId)) {
        return res.status(400).json({ error: "Invalid user ID." });
      }

      const user = await User.findById(userId);
      if (!user) {
        return res.status(404).json({ error: "Comment author not found." });
      }

      commentAuthor = user.username;
      commentUserId = user._id;
    }

    task.comments.push({
      author: commentAuthor,
      userId: commentUserId,
      text: String(commentText).trim()
    });

    await task.save();

    io.to(task.project.toString()).emit("comment_update", task);

    const project = await Project.findById(task.project);

    if (project && project.owner && String(project.owner) !== String(commentUserId)) {
      await notifyUser(
        project.owner,
        `New comment on task: ${task.title}`,
        task.project,
        task._id
      );
    }

    res.json(task);
  } catch (error) {
    handleError(res, error);
  }
});

// -------------------- NOTIFICATIONS --------------------

// Fetch notifications for a user.
app.get("/api/notifications", async (req, res) => {
  try {
    const { userId } = req.query;

    if (!userId || !mongoose.isValidObjectId(userId)) {
      return res.status(400).json({ error: "Valid userId query is required." });
    }

    const notifications = await Notification.find({ userId })
      .sort({ createdAt: -1 })
      .limit(50);

    res.json(notifications);
  } catch (error) {
    handleError(res, error, 500);
  }
});

// Mark one notification as read.
app.patch("/api/notifications/:id/read", async (req, res) => {
  try {
    const notification = await Notification.findByIdAndUpdate(
      req.params.id,
      { read: true },
      { new: true }
    );

    if (!notification) {
      return res.status(404).json({ error: "Notification not found." });
    }

    res.json(notification);
  } catch (error) {
    handleError(res, error);
  }
});

// -------------------- SOCKET.IO --------------------

io.on("connection", socket => {
  console.log("Socket connected:", socket.id);

  socket.on("join_project", async projectId => {
    if (typeof projectId === "string" &&
        mongoose.isValidObjectId(projectId)) {
      socket.join(projectId);
    }
  });

  // Optional: join a user's personal notification room.
  socket.on("join_user", userId => {
    if (typeof userId === "string" &&
        mongoose.isValidObjectId(userId)) {
      socket.join(`user:${userId}`);
    }
  });

  socket.on("disconnect", () => {
    console.log("Socket disconnected:", socket.id);
  });
});

// -------------------- START SERVER --------------------

mongoose.connect(MONGO_URI)
  .then(() => {
    console.log("MongoDB Connected Successfully");

    server.listen(PORT, () => {
      console.log(`ProjFlow server running at http://localhost:${PORT}`);
      console.log("API health check: http://localhost:" + PORT + "/api/health");
    });
  })
  .catch(error => {
    console.error("MongoDB connection failed:", error.message);
    process.exit(1);
  });
