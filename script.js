"use strict";

const API = "/api";

let panelKey =
  sessionStorage.getItem(
    "kn4ght_panel_key"
  );

let selectedProjectId = null;

document.addEventListener(
  "DOMContentLoaded",
  () => {

    document
      .getElementById("createBtn")
      .addEventListener(
        "click",
        createProject
      );

    document
      .getElementById("refreshBtn")
      .addEventListener(
        "click",
        loadProjects
      );

    document
      .getElementById("closeModal")
      .addEventListener(
        "click",
        closeModal
      );

    document
      .getElementById("uploadBtn")
      .addEventListener(
        "click",
        uploadProject
      );

    if (!panelKey) {
      askForKey();
    } else {
      loadProjects();
    }
  }
);

function askForKey() {

  const key = prompt(
    "Enter your Kn4ght Hosting panel key:"
  );

  if (!key) {
    return;
  }

  panelKey = key;

  sessionStorage.setItem(
    "kn4ght_panel_key",
    key
  );

  loadProjects();
}

async function api(
  endpoint,
  options = {}
) {

  const headers =
    options.headers || {};

  headers["x-panel-key"] =
    panelKey;

  options.headers = headers;

  const response =
    await fetch(
      API + endpoint,
      options
    );

  if (
    response.status === 401
  ) {

    sessionStorage.removeItem(
      "kn4ght_panel_key"
    );

    panelKey = null;

    alert(
      "Invalid panel key."
    );

    askForKey();

    throw new Error(
      "Unauthorized"
    );
  }

  const data =
    await response.json();

  if (!response.ok) {
    throw new Error(
      data.error ||
      "Request failed."
    );
  }

  return data;
}

async function loadProjects() {

  const container =
    document.getElementById(
      "projects"
    );

  container.innerHTML =
    `<div class="empty">
      Loading projects...
    </div>`;

  try {

    const projects =
      await api(
        "/projects"
      );

    renderProjects(
      projects
    );

  } catch (error) {

    container.innerHTML =
      `<div class="empty">
        ${escapeHTML(
          error.message
        )}
      </div>`;
  }
}

function renderProjects(
  projects
) {

  const container =
    document.getElementById(
      "projects"
    );

  if (!projects.length) {

    container.innerHTML =
      `<div class="empty">
        No projects yet.
        Create your first project above.
      </div>`;

    return;
  }

  container.innerHTML =
    projects.map(
      project => {

        const running =
          project.status ===
          "running";

        return `
          <article class="project">

            <div class="project-header">

              <div class="project-name">
                ${escapeHTML(
                  project.name
                )}
              </div>

              <span
                class="status ${
                  running
                    ? "running"
                    : "stopped"
                }">

                ${
                  running
                    ? "Running"
                    : "Stopped"
                }

              </span>

            </div>

            <div class="actions">

              ${
                running
                  ? `
                    <button
                      class="danger"
                      onclick="stopProject('${project.id}')">
                      Stop
                    </button>
                  `
                  : `
                    <button
                      class="primary"
                      onclick="startProject('${project.id}')">
                      Start
                    </button>
                  `
              }

              <button
                class="secondary"
                onclick="restartProject('${project.id}')">
                Restart
              </button>

              <button
                class="secondary"
                onclick="openUpload('${project.id}', '${escapeAttribute(project.name)}')">
                Upload
              </button>

              <button
                class="secondary"
                onclick="showLogs('${project.id}')">
                Logs
              </button>

              <button
                class="danger"
                onclick="deleteProject('${project.id}')">
                Delete
              </button>

            </div>

            <pre
              id="logs-${project.id}"
              class="logs"
              style="display:none;"></pre>

          </article>
        `;
      }
    ).join("");
}

async function createProject() {

  const input =
    document.getElementById(
      "projectName"
    );

  const name =
    input.value.trim();

  if (!name) {
    alert(
      "Enter a project name."
    );
    return;
  }

  try {

    await api(
      "/projects",
      {
        method: "POST",

        headers: {
          "Content-Type":
            "application/json"
        },

        body:
          JSON.stringify({
            name
          })
      }
    );

    input.value = "";

    await loadProjects();

  } catch (error) {

    alert(
      error.message
    );
  }
}

async function startProject(id) {

  try {

    await api(
      `/projects/${id}/start`,
      {
        method: "POST"
      }
    );

    await loadProjects();

  } catch (error) {

    alert(
      error.message
    );
  }
}

async function stopProject(id) {

  try {

    await api(
      `/projects/${id}/stop`,
      {
        method: "POST"
      }
    );

    await loadProjects();

  } catch (error) {

    alert(
      error.message
    );
  }
}

async function restartProject(id) {

  try {

    await api(
      `/projects/${id}/restart`,
      {
        method: "POST"
      }
    );

    await loadProjects();

  } catch (error) {

    alert(
      error.message
    );
  }
}

function openUpload(
  id,
  name
) {

  selectedProjectId =
    id;

  document
    .getElementById(
      "uploadProjectName"
    )
    .textContent =
    `Project: ${name}`;

  document
    .getElementById(
      "zipFile"
    )
    .value = "";

  document
    .getElementById(
      "uploadStatus"
    )
    .textContent = "";

  document
    .getElementById(
      "modal"
    )
    .classList.remove(
      "hidden"
    );
}

function closeModal() {

  document
    .getElementById(
      "modal"
    )
    .classList.add(
      "hidden"
    );

  selectedProjectId =
    null;
}

async function uploadProject() {

  const file =
    document
      .getElementById(
        "zipFile"
      )
      .files[0];

  const status =
    document
      .getElementById(
        "uploadStatus"
      );

  if (!file) {

    status.textContent =
      "Choose a ZIP file.";

    return;
  }

  status.textContent =
    "Uploading...";

  const form =
    new FormData();

  form.append(
    "file",
    file
  );

  try {

    await api(
      `/projects/${selectedProjectId}/upload`,
      {
        method: "POST",
        body: form
      }
    );

    status.textContent =
      "Upload complete.";

    setTimeout(
      () => {
        closeModal();
        loadProjects();
      },
      700
    );

  } catch (error) {

    status.textContent =
      error.message;
  }
}

async function showLogs(id) {

  const element =
    document.getElementById(
      `logs-${id}`
    );

  if (
    element.style.display ===
    "block"
  ) {

    element.style.display =
      "none";

    return;
  }

  element.style.display =
    "block";

  element.textContent =
    "Loading logs...";

  try {

    const data =
      await api(
        `/projects/${id}/logs`
      );

    element.textContent =
      data.logs ||
      "No logs.";

  } catch (error) {

    element.textContent =
      error.message;
  }
}

async function deleteProject(id) {

  if (
    !confirm(
      "Delete this project and its files?"
    )
  ) {
    return;
  }

  try {

    await api(
      `/projects/${id}`,
      {
        method: "DELETE"
      }
    );

    await loadProjects();

  } catch (error) {

    alert(
      error.message
    );
  }
}

function escapeHTML(value) {

  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function escapeAttribute(value) {

  return escapeHTML(value)
    .replaceAll(
      "'",
      "\\'"
    );
}