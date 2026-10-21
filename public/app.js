
const API = window.location.origin;
const STATUS = ["Todo", "In Progress", "Done"];

let currentUser = JSON.parse(localStorage.getItem("projflowUser") || "null");
let projects = [];
let activeProject = null;
let tasks = [];
let activeTaskId = null;
let authMode = "login";
let socket = null;
let toastTimer = null;

const escapeHTML = (value = "") =>
  String(value).replace(/[&<>"']/g, char => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  })[char]);

const getInitials = name =>
  String(name || "U").trim().slice(0, 2).toUpperCase();

function toast(message, isError = false) {
  document.querySelector(".toast")?.remove();
  clearTimeout(toastTimer);

  const el = document.createElement("div");
  el.className = `toast${isError ? " error" : ""}`;
  el.textContent = message;
  document.body.appendChild(el);

  toastTimer = setTimeout(() => el.remove(), 3500);
}

async function api(path, options = {}) {
  let response;

  try {
    response = await fetch(`${API}${path}`, {
      ...options,
      headers: {
        "Content-Type": "application/json",
        ...(options.headers || {})
      }
    });
  } catch {
    throw new Error(
      "Backend connect nahi ho raha. Terminal mein npm start check karo."
    );
  }

  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(data.error || data.message || `Request failed (${response.status})`);
  }

  return data;
}

function request(method, body) {
  return {
    method,
    body: JSON.stringify(body)
  };
}

function initSocket() {
  if (typeof window.io !== "function") {
    console.warn("Socket.IO client nahi mila. Check index.html script.");
    return;
  }

  if (socket) socket.disconnect();

  socket = window.io(API);

  socket.on("connect", () => {
    if (activeProject?._id) {
      socket.emit("join_project", activeProject._id);
    }
  });

  socket.on("task_update", task => {
    if (activeProject && String(task.project) === String(activeProject._id)) {
      loadProject(activeProject._id, false);
    }
  });

  socket.on("comment_update", task => {
    if (activeTaskId && String(task._id) === String(activeTaskId)) {
      loadProject(activeProject._id, false).then(() => {
        if (activeTaskId) openTask(activeTaskId, false);
      });
    } else if (activeProject && String(task.project) === String(activeProject._id)) {
      loadProject(activeProject._id, false);
    }
  });
}

function renderShell(content) {
  document.body.innerHTML = `
    <header class="topbar">
      <div class="brand">
        <span class="brand-mark">P</span>
        <span>ProjFlow</span>
      </div>
      <div class="user-area">
        <span>${escapeHTML(currentUser?.username || "")}</span>
        <button class="ghost" id="logoutBtn">Log out ↗</button>
      </div>
    </header>
    <main class="page" id="mainContent">${content}</main>
    <div id="modalRoot"></div>
  `;

  document.getElementById("logoutBtn").addEventListener("click", logout);
}

function renderAuth() {
  document.body.innerHTML = `
    <main class="auth-page">
      <section class="auth-card">
        <div class="brand">
          <span class="brand-mark">P</span>
          <span>ProjFlow</span>
        </div>
        <h1>${authMode === "login" ? "Welcome back" : "Create your account"}</h1>
        <p class="muted">
          ${authMode === "login"
            ? "Sign in to continue managing your projects."
            : "Create an account to get started with your team."}
        </p>

        <div class="notice">
          Organize projects, track tasks and collaborate with your team.
        </div>

        <form id="authForm">
          ${authMode === "register" ? `
            <div class="field">
              <label for="authUsername">Username</label>
              <input id="authUsername" name="username" required minlength="2"
                autocomplete="username" placeholder="Enter your username">
            </div>
          ` : ""}

          <div class="field">
            <label for="authEmail">Email address</label>
            <input id="authEmail" name="email" type="email" required
              autocomplete="email" placeholder="you@example.com">
          </div>

          <div class="field">
            <label for="authPassword">Password</label>
            <input id="authPassword" name="password" type="password"
              required minlength="6" autocomplete="${authMode === "login" ? "current-password" : "new-password"}"
              placeholder="Enter your password">
          </div>

          <button class="primary" id="authSubmit" type="submit" style="width:100%">
            ${authMode === "login" ? "Sign in" : "Create account"}
          </button>
        </form>

        <p class="auth-switch">
          ${authMode === "login" ? "Don't have an account?" : "Already registered?"}
          <button id="authToggle" type="button">
            ${authMode === "login" ? "Register" : "Sign in"}
          </button>
        </p>
      </section>
    </main>
  `;

  document.getElementById("authToggle").addEventListener("click", () => {
    authMode = authMode === "login" ? "register" : "login";
    renderAuth();
  });

  document.getElementById("authForm").addEventListener("submit", handleAuth);
}

async function handleAuth(event) {
  event.preventDefault();

  const form = new FormData(event.currentTarget);
  const button = document.getElementById("authSubmit");
  button.disabled = true;
  button.textContent = "Please wait...";

  try {
    const email = String(form.get("email")).trim().toLowerCase();
    const password = String(form.get("password"));
    let username = String(form.get("username") || "").trim();

    if (authMode === "register") {
      await api("/api/auth/register", request("POST", {
        username,
        email,
        password
      }));

      toast("Account created! Now sign in.");
      authMode = "login";
      renderAuth();
      document.getElementById("authEmail").value = email;
      return;
    }

    const result = await api("/api/auth/login", request("POST", {
      email,
      password
    }));

    currentUser = {
      username: result.username,
      userId: result.userId
    };

    localStorage.setItem("projflowUser", JSON.stringify(currentUser));
    initSocket();
    await loadProjects();
    toast("Welcome to ProjFlow!");
  } catch (error) {
    toast(error.message, true);
  } finally {
    const submit = document.getElementById("authSubmit");
    if (submit) {
      submit.disabled = false;
      submit.textContent = authMode === "login" ? "Sign in" : "Create account";
    }
  }
}

function logout() {
  currentUser = null;
  projects = [];
  tasks = [];
  activeProject = null;
  activeTaskId = null;

  localStorage.removeItem("projflowUser");

  if (socket) {
    socket.disconnect();
    socket = null;
  }

  authMode = "login";
  renderAuth();
}

async function loadProjects() {
  try {
    projects = await api("/api/projects");
    renderProjects();
  } catch (error) {
    renderShell(`
      <h1>My Projects</h1>
      <p class="muted">Projects load nahi ho sake.</p>
      <button class="primary" id="retryProjects">Try again</button>
    `);

    document.getElementById("retryProjects").onclick = loadProjects;
    toast(error.message, true);
  }
}

function renderProjects() {
  renderShell(`
    <div class="page-heading">
      <div>
        <h1>My Projects</h1>
        <p class="muted">Plan your work. Track progress. Build together.</p>
      </div>
      <button class="primary" id="newProjectBtn">+ New project</button>
    </div>

    <div class="project-grid" id="projectGrid">
      ${projects.length ? projects.map((project, index) => `
        <button class="project-card" data-project-id="${escapeHTML(project._id)}">
          <div class="project-icon">${["✦", "◈", "▦", "✧"][index % 4]}</div>
          <h3>${escapeHTML(project.title)}</h3>
          <p>${escapeHTML(project.description || "No description added yet.")}</p>
          <div class="project-meta">
            <span>▦ Open board</span>
            <span>→</span>
          </div>
        </button>
      `).join("") : `
        <div class="panel">
          <h3>No projects yet</h3>
          <p class="muted">Create your first project to start organizing tasks.</p>
        </div>
      `}
    </div>
  `);

  document.getElementById("newProjectBtn").onclick = showCreateProject;

  document.querySelectorAll("[data-project-id]").forEach(card => {
    card.addEventListener("click", () => {
      loadProject(card.dataset.projectId);
    });
  });
}

function showCreateProject() {
  showModal(`
    <div class="modal-header">
      <div>
        <h2>Create a project</h2>
        <p class="muted">Give your project a name and description.</p>
      </div>
      <button class="ghost" data-close-modal>✕</button>
    </div>

    <form id="createProjectForm">
      <div class="field">
        <label for="projectTitle">Project name</label>
        <input id="projectTitle" required maxlength="100"
          placeholder="e.g. Website redesign">
      </div>
      <div class="field">
        <label for="projectDescription">Description</label>
        <textarea id="projectDescription" maxlength="1000"
          placeholder="What is this project about?"></textarea>
      </div>
      <div class="form-actions">
        <button type="button" class="ghost" data-close-modal>Cancel</button>
        <button type="submit" class="primary">Create project</button>
      </div>
    </form>
  `);

  document.getElementById("createProjectForm").addEventListener("submit", async event => {
    event.preventDefault();

    const button = event.currentTarget.querySelector('[type="submit"]');
    button.disabled = true;

    try {
      await api("/api/projects", request("POST", {
        title: document.getElementById("projectTitle").value.trim(),
        description: document.getElementById("projectDescription").value.trim()
      }));

      closeModal();
      await loadProjects();
      toast("Project created successfully.");
    } catch (error) {
      toast(error.message, true);
      button.disabled = false;
    }
  });
}

async function loadProject(projectId, showLoading = true) {
  if (!projectId) return;

  if (showLoading) {
    renderShell(`<div class="loading">Loading project board...</div>`);
  }

  try {
    const result = await api(`/api/projects/${encodeURIComponent(projectId)}`);

    if (!result.project) {
      throw new Error("Project not found.");
    }

    activeProject = result.project;
    tasks = Array.isArray(result.tasks) ? result.tasks : [];

    if (socket?.connected) {
      socket.emit("join_project", String(activeProject._id));
    }

    renderBoard();
  } catch (error) {
    toast(error.message, true);
    await loadProjects();
  }
}

function renderBoard() {
  if (!activeProject) return;

  const columns = [
    { name: "Todo", dot: "todo-dot" },
    { name: "In Progress", dot: "progress-dot" },
    { name: "Done", dot: "done-dot" }
  ];

  renderShell(`
    <div class="board-toolbar">
      <div>
        <button class="ghost" id="backProjects">← All projects</button>
        <h1 style="margin-top:12px">${escapeHTML(activeProject.title)}</h1>
        <p class="muted">${escapeHTML(activeProject.description || "Project task board")}</p>
      </div>
      <button class="primary" id="newTaskBtn">+ Add task</button>
    </div>

    <div class="board" id="taskBoard">
      ${columns.map(column => {
        const list = tasks.filter(task => task.status === column.name);

        return `
          <section class="board-column" data-status="${column.name}">
            <div class="column-heading">
              <span class="column-title">
                <span class="status-dot ${column.dot}"></span>
                ${column.name}
              </span>
              <span class="count">${list.length}</span>
            </div>
            <div class="task-list">
              ${list.length ? list.map(renderTaskCard).join("") : `
                <div class="empty">No tasks here yet</div>
              `}
            </div>
          </section>
        `;
      }).join("")}
    </div>
  `);

  document.getElementById("backProjects").onclick = async () => {
    activeProject = null;
    activeTaskId = null;
    await loadProjects();
  };

  document.getElementById("newTaskBtn").onclick = showCreateTask;

  document.querySelectorAll("[data-task-open]").forEach(button => {
    button.addEventListener("click", () => openTask(button.dataset.taskOpen));
  });

  document.querySelectorAll("[data-task-status]").forEach(select => {
    select.addEventListener("change", async () => {
      const task = tasks.find(item => String(item._id) === select.dataset.taskStatus);
      if (!task) return;

      try {
        await api(`/api/tasks/${encodeURIComponent(task._id)}`, request("PUT", {
          status: select.value,
          title: task.title,
          assignedTo: task.assignedTo || "Unassigned"
        }));

        await loadProject(activeProject._id, false);
        toast("Task status updated.");
      } catch (error) {
        toast(error.message, true);
        await loadProject(activeProject._id, false);
      }
    });
  });
}

function renderTaskCard(task) {
  return `
    <article class="task-card">
      <h3>${escapeHTML(task.title)}</h3>
      ${task.description ? `
        <p class="task-description">${escapeHTML(task.description)}</p>
      ` : ""}

      <div class="task-footer">
        <span class="assignee">◉ ${escapeHTML(task.assignedTo || "Unassigned")}</span>
        <div class="task-actions">
          <button class="small-button" data-task-open="${escapeHTML(task._id)}">
            Comments
          </button>
          <select aria-label="Change task status"
            data-task-status="${escapeHTML(task._id)}">
            ${STATUS.map(status => `
              <option value="${status}" ${task.status === status ? "selected" : ""}>
                ${status}
              </option>
            `).join("")}
          </select>
        </div>
      </div>
    </article>
  `;
}

function showCreateTask() {
  if (!activeProject) return;

  showModal(`
    <div class="modal-header">
      <div>
        <h2>Add a task</h2>
        <p class="muted">Create a task for this project.</p>
      </div>
      <button class="ghost" data-close-modal>✕</button>
    </div>

    <form id="createTaskForm">
      <div class="field">
        <label for="taskTitle">Task title</label>
        <input id="taskTitle" required maxlength="150"
          placeholder="e.g. Design login page">
      </div>
      <div class="field">
        <label for="taskDescription">Description</label>
        <textarea id="taskDescription" maxlength="2000"
          placeholder="Task details..."></textarea>
      </div>
      <div class="form-grid">
        <div class="field">
          <label for="taskAssignee">Assign to</label>
          <input id="taskAssignee" maxlength="100"
            placeholder="Username or name">
        </div>
        <div class="field">
          <label for="taskStatus">Status</label>
          <select id="taskStatus">
            ${STATUS.map(status => `<option>${status}</option>`).join("")}
          </select>
        </div>
      </div>
      <div class="form-actions">
        <button type="button" class="ghost" data-close-modal>Cancel</button>
        <button type="submit" class="primary">Create task</button>
      </div>
    </form>
  `);

  document.getElementById("createTaskForm").addEventListener("submit", async event => {
    event.preventDefault();

    const button = event.currentTarget.querySelector('[type="submit"]');
    button.disabled = true;

    try {
      await api("/api/tasks", request("POST", {
        title: document.getElementById("taskTitle").value.trim(),
        description: document.getElementById("taskDescription").value.trim(),
        projectId: activeProject._id,
        status: document.getElementById("taskStatus").value,
        assignedTo: document.getElementById("taskAssignee").value.trim() || "Unassigned"
      }));

      closeModal();
      await loadProject(activeProject._id, false);
      toast("Task created successfully.");
    } catch (error) {
      toast(error.message, true);
      button.disabled = false;
    }
  });
}

async function openTask(taskId, showLoading = true) {
  activeTaskId = taskId;

  let task = tasks.find(item => String(item._id) === String(taskId));

  if (!task) {
    toast("Task not found. Refreshing the board.", true);
    return;
  }

  if (showLoading) {
    showModal(`<div class="loading">Loading task comments...</div>`);
  }

  // Fetch the latest task data using the existing project endpoint.
  try {
    const result = await api(`/api/projects/${encodeURIComponent(activeProject._id)}`);
    tasks = result.tasks || tasks;
    task = tasks.find(item => String(item._id) === String(taskId)) || task;
  } catch {
    // Keep the task data already available on the board.
  }

  if (activeTaskId !== taskId) return;

  showModal(`
    <div class="modal-header">
      <div>
        <h2>${escapeHTML(task.title)}</h2>
        <p class="muted">${escapeHTML(task.status || "Todo")} · Assigned to ${escapeHTML(task.assignedTo || "Unassigned")}</p>
      </div>
      <button class="ghost" data-close-modal>✕</button>
    </div>

    <p class="task-description">${escapeHTML(task.description || "No description provided.")}</p>

    <h3 style="margin-top:25px">Discussion & comments</h3>

    <div class="comment-list">
      ${(task.comments || []).length ? task.comments.map(comment => `
        <div class="comment">
          <div class="comment-author">${escapeHTML(comment.author || "User")}</div>
          <div class="comment-text">${escapeHTML(comment.text)}</div>
          <div class="comment-date">
            ${comment.createdAt ? escapeHTML(new Date(comment.createdAt).toLocaleString()) : ""}
          </div>
        </div>
      `).join("") : `<div class="empty">No comments yet. Start the conversation.</div>`}
    </div>

    <form id="commentForm">
      <div class="field">
        <label for="commentText">Write a comment</label>
        <textarea id="commentText" required maxlength="2000"
          placeholder="Share an update or ask a question..."></textarea>
      </div>
      <div class="form-actions">
        <button type="button" class="ghost" data-close-modal>Close</button>
        <button type="submit" class="primary">Post comment</button>
      </div>
    </form>
  `);

  document.getElementById("commentForm").addEventListener("submit", async event => {
    event.preventDefault();

    const button = event.currentTarget.querySelector('[type="submit"]');
    const text = document.getElementById("commentText").value.trim();

    if (!text) return;

    button.disabled = true;

    try {
      await api(`/api/tasks/${encodeURIComponent(task._id)}/comments`, request("POST", {
        author: currentUser.username,
        text
      }));

      await loadProject(activeProject._id, false);
      await openTask(task._id, false);
      toast("Comment posted.");
    } catch (error) {
      toast(error.message, true);
      button.disabled = false;
    }
  });
}

function showModal(html) {
  const root = document.getElementById("modalRoot");
  if (!root) return;

  root.innerHTML = `
    <div class="overlay" id="modalOverlay">
      <section class="modal">${html}</section>
    </div>
  `;

  root.querySelectorAll("[data-close-modal]").forEach(button => {
    button.addEventListener("click", closeModal);
  });

  root.querySelector("#modalOverlay").addEventListener("click", event => {
    if (event.target.id === "modalOverlay") closeModal();
  });
}

function closeModal() {
  const root = document.getElementById("modalRoot");
  if (root) root.innerHTML = "";
  activeTaskId = null;
}

function startApp() {
  if (!currentUser?.userId || !currentUser?.username) {
    renderAuth();
    return;
  }

  initSocket();
  loadProjects();
}

startApp();
