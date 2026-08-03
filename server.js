"use strict";

const express = require("express");
const multer = require("multer");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const Docker = require("dockerode");
const AdmZip = require("adm-zip");

require("dotenv").config();

const app = express();
const docker = new Docker();

const PORT = Number(process.env.PORT || 3000);
const PANEL_KEY = process.env.PANEL_KEY;

if (!PANEL_KEY) {
  console.error("PANEL_KEY is missing from .env");
  process.exit(1);
}

const ROOT = __dirname;
const DATA_DIR = path.join(ROOT, "data");
const UPLOAD_DIR = path.join(ROOT, "uploads");
const DASHBOARD_DIR = path.join(ROOT, "dashboard");
const PROJECT_FILE = path.join(DATA_DIR, "projects.json");

fs.mkdirSync(DATA_DIR, { recursive: true });
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

if (!fs.existsSync(PROJECT_FILE)) {
  fs.writeFileSync(PROJECT_FILE, "[]");
}

app.use(express.json());

app.use(express.static(DASHBOARD_DIR));

function readProjects() {
  try {
    return JSON.parse(
      fs.readFileSync(PROJECT_FILE, "utf8")
    );
  } catch {
    return [];
  }
}

function saveProjects(projects) {
  fs.writeFileSync(
    PROJECT_FILE,
    JSON.stringify(projects, null, 2)
  );
}

function safeName(name) {
  return String(name || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-_]/g, "-")
    .replace(/-+/g, "-")
    .slice(0, 32);
}

function projectDirectory(id) {
  return path.join(UPLOAD_DIR, id);
}

function getProject(id) {
  return readProjects().find(
    project => project.id === id
  );
}

function auth(req, res, next) {
  const supplied = req.headers["x-panel-key"];

  if (typeof supplied !== "string") {
    return res.status(401).json({
      error: "Unauthorized"
    });
  }

  const a = Buffer.from(supplied);
  const b = Buffer.from(PANEL_KEY);

  if (
    a.length !== b.length ||
    !crypto.timingSafeEqual(a, b)
  ) {
    return res.status(401).json({
      error: "Unauthorized"
    });
  }

  next();
}

const maxMB = Number(
  process.env.MAX_UPLOAD_MB || 25
);

const upload = multer({
  dest: UPLOAD_DIR,

  limits: {
    fileSize: maxMB * 1024 * 1024
  },

  fileFilter(req, file, callback) {
    const ext = path.extname(
      file.originalname
    ).toLowerCase();

    if (ext !== ".zip") {
      return callback(
        new Error("Only ZIP files are allowed.")
      );
    }

    callback(null, true);
  }
});

/* HEALTH */

app.get("/api/health", (req, res) => {
  res.json({
    ok: true,
    service: "Kn4ght Hosting"
  });
});

/* PROJECT LIST */

app.get(
  "/api/projects",
  auth,
  async (req, res) => {
    const projects = readProjects();
    const result = [];

    for (const project of projects) {
      let status = "stopped";

      if (project.containerId) {
        try {
          const container =
            docker.getContainer(
              project.containerId
            );

          const info =
            await container.inspect();

          if (info.State.Running) {
            status = "running";
          }
        } catch {
          status = "stopped";
        }
      }

      result.push({
        id: project.id,
        name: project.name,
        status,
        createdAt: project.createdAt
      });
    }

    res.json(result);
  }
);

/* CREATE PROJECT */

app.post(
  "/api/projects",
  auth,
  (req, res) => {
    const name = safeName(
      req.body.name
    );

    if (!name) {
      return res.status(400).json({
        error: "Enter a valid project name."
      });
    }

    const projects = readProjects();

    if (
      projects.some(
        project => project.name === name
      )
    ) {
      return res.status(409).json({
        error: "Project already exists."
      });
    }

    const id = crypto.randomUUID();

    const project = {
      id,
      name,
      containerId: null,
      createdAt:
        new Date().toISOString()
    };

    fs.mkdirSync(
      projectDirectory(id),
      { recursive: true }
    );

    projects.push(project);
    saveProjects(projects);

    res.json({
      success: true,
      project
    });
  }
);

/* UPLOAD */

app.post(
  "/api/projects/:id/upload",
  auth,
  upload.single("file"),
  async (req, res) => {
    if (!req.file) {
      return res.status(400).json({
        error: "ZIP file required."
      });
    }

    const project =
      getProject(req.params.id);

    if (!project) {
      fs.unlinkSync(req.file.path);

      return res.status(404).json({
        error: "Project not found."
      });
    }

    const directory =
      projectDirectory(project.id);

    try {
      if (project.containerId) {
        try {
          const container =
            docker.getContainer(
              project.containerId
            );

          try {
            await container.stop({
              t: 5
            });
          } catch {}

          try {
            await container.remove({
              force: true
            });
          } catch {}
        } catch {}

        project.containerId = null;
        saveProjects(
          readProjects().map(p =>
            p.id === project.id
              ? project
              : p
          )
        );
      }

      fs.rmSync(directory, {
        recursive: true,
        force: true
      });

      fs.mkdirSync(directory, {
        recursive: true
      });

      const zip =
        new AdmZip(req.file.path);

      zip.extractAllTo(
        directory,
        true
      );

      fs.unlinkSync(
        req.file.path
      );

      res.json({
        success: true,
        message: "Project uploaded."
      });
    } catch (error) {
      try {
        fs.unlinkSync(
          req.file.path
        );
      } catch {}

      res.status(400).json({
        error:
          "Unable to extract project."
      });
    }
  }
);

/* START */

app.post(
  "/api/projects/:id/start",
  auth,
  async (req, res) => {
    const projects = readProjects();

    const project =
      projects.find(
        p => p.id === req.params.id
      );

    if (!project) {
      return res.status(404).json({
        error: "Project not found."
      });
    }

    const directory =
      projectDirectory(project.id);

    if (!fs.existsSync(directory)) {
      return res.status(400).json({
        error:
          "Upload a project first."
      });
    }

    const packageFile =
      path.join(
        directory,
        "package.json"
      );

    if (!fs.existsSync(packageFile)) {
      return res.status(400).json({
        error:
          "package.json is required."
      });
    }

    if (project.containerId) {
      try {
        const old =
          docker.getContainer(
            project.containerId
          );

        const info =
          await old.inspect();

        if (info.State.Running) {
          return res.json({
            success: true,
            message:
              "Project is already running."
          });
        }

        try {
          await old.remove({
            force: true
          });
        } catch {}
      } catch {}

      project.containerId = null;
    }

    try {
      const memory =
        Number(
          process.env
            .CONTAINER_MEMORY_MB || 512
        ) *
        1024 *
        1024;

      const nanoCPUs =
        Number(
          process.env
            .CONTAINER_CPU_NANOS ||
          500000000
        );

      const container =
        await docker.createContainer({
          Image: "node:22-alpine",

          WorkingDir: "/app",

          Cmd: [
            "sh",
            "-c",
            "npm install --omit=dev && npm start"
          ],

          HostConfig: {
            Binds: [
              `${directory}:/app`
            ],

            Memory: memory,

            NanoCpus: nanoCPUs,

            PidsLimit: 128,

            NetworkMode: "bridge",

            RestartPolicy: {
              Name: "unless-stopped"
            }
          }
        });

      await container.start();

      project.containerId =
        container.id;

      saveProjects(projects);

      res.json({
        success: true,
        message:
          "Project started."
      });
    } catch (error) {
      console.error(error);

      res.status(500).json({
        error:
          "Unable to start project."
      });
    }
  }
);

/* STOP */

app.post(
  "/api/projects/:id/stop",
  auth,
  async (req, res) => {
    const project =
      getProject(req.params.id);

    if (!project) {
      return res.status(404).json({
        error: "Project not found."
      });
    }

    if (!project.containerId) {
      return res.json({
        success: true,
        message: "Already stopped."
      });
    }

    try {
      const container =
        docker.getContainer(
          project.containerId
        );

      await container.stop({
        t: 5
      });

      res.json({
        success: true,
        message: "Project stopped."
      });
    } catch {
      res.status(500).json({
        error:
          "Unable to stop project."
      });
    }
  }
);

/* RESTART */

app.post(
  "/api/projects/:id/restart",
  auth,
  async (req, res) => {
    const project =
      getProject(req.params.id);

    if (!project) {
      return res.status(404).json({
        error: "Project not found."
      });
    }

    if (!project.containerId) {
      return res.status(400).json({
        error:
          "Project is not running."
      });
    }

    try {
      const container =
        docker.getContainer(
          project.containerId
        );

      await container.restart();

      res.json({
        success: true,
        message:
          "Project restarted."
      });
    } catch {
      res.status(500).json({
        error:
          "Unable to restart project."
      });
    }
  }
);

/* LOGS */

app.get(
  "/api/projects/:id/logs",
  auth,
  async (req, res) => {
    const project =
      getProject(req.params.id);

    if (
      !project ||
      !project.containerId
    ) {
      return res.json({
        logs: "No logs available."
      });
    }

    try {
      const container =
        docker.getContainer(
          project.containerId
        );

      const logs =
        await container.logs({
          stdout: true,
          stderr: true,
          timestamps: true,
          tail: 200
        });

      res.json({
        logs: logs.toString()
      });
    } catch {
      res.status(500).json({
        error:
          "Unable to retrieve logs."
      });
    }
  }
);

/* DELETE */

app.delete(
  "/api/projects/:id",
  auth,
  async (req, res) => {
    const projects =
      readProjects();

    const index =
      projects.findIndex(
        p => p.id === req.params.id
      );

    if (index === -1) {
      return res.status(404).json({
        error:
          "Project not found."
      });
    }

    const project =
      projects[index];

    if (project.containerId) {
      try {
        const container =
          docker.getContainer(
            project.containerId
          );

        try {
          await container.stop({
            t: 5
          });
        } catch {}

        try {
          await container.remove({
            force: true
          });
        } catch {}
      } catch {}
    }

    fs.rmSync(
      projectDirectory(
        project.id
      ),
      {
        recursive: true,
        force: true
      }
    );

    projects.splice(index, 1);

    saveProjects(projects);

    res.json({
      success: true,
      message:
        "Project deleted."
    });
  }
);

/* DASHBOARD */

app.get(
  "*splat",
  (req, res) => {
    res.sendFile(
      path.join(
        DASHBOARD_DIR,
        "index.html"
      )
    );
  }
);

/* ERRORS */

app.use(
  (error, req, res, next) => {
    console.error(error);

    res.status(400).json({
      error:
        error.message ||
        "Request failed."
    });
  }
);

app.listen(
  PORT,
  "0.0.0.0",
  () => {
    console.log(
      `Kn4ght Hosting running on port ${PORT}`
    );
  }
);