"use strict";

/*
 * KN4GHT HOSTING DASHBOARD
 *
 * IMPORTANT:
 * GitHub Pages only hosts the frontend.
 * Your Node.js backend must run somewhere else.
 *
 * After you deploy server.js, change BACKEND_URL below.
 *
 * Example:
 * const BACKEND_URL = "https://api.kn4ght.example";
 *
 * Do NOT put your panel key directly in this file.
 */

const BACKEND_URL = "";

let panelKey =
  sessionStorage.getItem("kn4ght_panel_key") || "";

let selectedProjectId = null;

const $ = (id) =>
  document.getElementById(id);

document.addEventListener(
  "DOMContentLoaded",
  () => {

    $("createBtn")?.addEventListener(
      "click",
      createProject
    );

    $("refreshBtn")?.addEventListener(
      "click",
      loadProjects
    );

    $("closeModal")?.addEventListener(
      "click",
      closeModal
    );

    $("uploadBtn")?.addEventListener(
      "click",
      uploadProject
    );

    if (!BACKEND_URL) {
      showBackendMessage();
      return;
    }

    if (!panelKey) {
      askForKey();
    } else {
      loadProjects();
    }
  }
);

function showBackendMessage() {

  const container =
    $("projects");

  if (!container) return;

  container.innerHTML = `
    <div class="empty">
      <strong>Backend not connected</strong>
      <br><br>
      Your GitHub Pages dashboard is working,
      but the Kn4ght Hosting backend is not
      configured yet.
      <br><br>
      Deploy <code>server.js</code> to your VPS,
      then set <code>BACKEND_URL</code> in
      <code>script.js</code>.
    </div>
  `;
}

function askForKey() {

  const key = prompt(
    "Enter your Kn4ght Hosting panel key:"
  );

  if (!key) {
    showBackendMessage();
    return;
  }

  panelKey = key;

  sessionStorage.setItem(
    "kn4ght_panel_key",
    key
  );

  loadProjects();
}

function backendUrl(path) {

  return (
    BACKEND_URL.replace(/\/+$/, "") +
    "/api" +
    path
  );
}

async function api(
  path,
  options = {}
) {

  if (!BACKEND_URL) {
    throw new Error(
      "Backend URL has not been configured."
    );
  }

  const headers = {
    ...(options.headers || {})
  };

  headers[
    "x-panel-key"
  ] = panelKey;

  options.headers = headers;

  let response;

  try {

    response = await fetch(
      backendUrl(path),
      options
    );

  } catch (error) {

    throw new Error(
      "Cannot connect to the Kn4ght Hosting backend."
    );
  }

  const contentType =
    response.headers.get(
      "content-type"
    ) || "";

  /*
   * This prevents the:
   *
   * Unexpected token '<'
   *
   * error when a server sends HTML
   * instead of JSON.
   */

  if (
    !contentType.includes(
      "application/json"
    )
  ) {

    const text =
      await response.text();

    console.error(
      "Backend returned non-JSON:",
      text.slice(0, 500)
    );

    throw new Error(
      "The backend returned HTML instead of JSON. Check your backend URL."
    );
  }

  const data =
    await response.json();

  if (response.status === 401) {

    sessionStorage.removeItem(
      "kn4ght_panel_key"
    );

    panelKey = "";

    alert(
      "Invalid panel key."
    );

    askForKey();

    throw new Error(
      "Unauthorized"
    );
  }

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
    $("projects");

  if (!container) return;

  container.innerHTML = `
    <div class="empty">
      Loading projects...
    </div>
  `;

  try {

    const projects =
      await api("/projects");

    renderProjects(
      projects
    );

  } catch (error) {

    container.innerHTML = `
      <div class="empty">
        <strong>Unable to load projects</strong>
        <br><br>
        ${escapeHTML(
          error.message
        )}
      </div>
    `;
  }
}

function renderProjects(
  projects
) {

  const container =
    $("projects");

  if (!projects.length) {

    container.innerHTML = `
      <div class="empty">
        No projects yet.
        <br><br>
        Create your first project above.
      </div>
    `;

    return;
  }

  container.innerHTML =
    projects.map(
      project => {

        const running =
          project.status ===
          "running";

        const id =
          escapeAttribute(
            project.id
          );

        const name =
          escapeHTML(
            project.name
          );

        return `
          <article
            class="project">

            <div
              class="project-header">

              <div
                class="project-name">
                ${name}
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
                      onclick="stopProject('${id}')">
                      Stop
                    </button>
                  `
                  : `
                    <button
                      class="primary"
                      onclick="startProject('${id}')">
                      Start
                    </button>
                  `
              }

              <button
                class="secondary"
                onclick="restartProject('${id}')">
                Restart
              </button>

              <button
                class="secondary"
                onclick="openUpload(
                  '${id}',
                  '${escapeAttribute(
                    project.name
                  )}'
                )">
                Upload
              </button>

              <button
                class="secondary"
                onclick="showLogs('${id}')">
                Logs
              </button>

              <button
                class="danger"
                onclick="deleteProject('${id}')">
                Delete
              </button>

            </div>

            <pre
              id="logs-${id}"
              class="logs"
              style="display:none;"></pre>

          </article>
        `;
      }
    ).join("");
}

async function createProject() {

  const input =
    $("projectName");

  if (!input) return;

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

async function startProject(
  id
) {

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

async function stopProject(
  id
) {

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

async function restartProject(
  id
) {

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

  const projectName =
    $("uploadProjectName");

  const file =
    $("zipFile");

  const status =
    $("uploadStatus");

  if (projectName) {
    projectName.textContent =
      `Project: ${name}`;
  }

  if (file) {
    file.value = "";
  }

  if (status) {
    status.textContent = "";
  }

  $("modal")?.classList.remove(
    "hidden"
  );
}

function closeModal() {

  $("modal")?.classList.add(
    "hidden"
  );

  selectedProjectId =
    null;
}

async function uploadProject() {

  if (!selectedProjectId) {
    return;
  }

  const fileInput =
    $("zipFile");

  const status =
    $("uploadStatus");

  const file =
    fileInput?.files?.[0];

  if (!file) {

    if (status) {
      status.textContent =
        "Choose a ZIP file.";
    }

    return;
  }

  if (
    !file.name
      .toLowerCase()
      .endsWith(".zip")
  ) {

    if (status) {
      status.textContent =
        "Only ZIP files are allowed.";
    }

    return;
  }

  if (status) {
    status.textContent =
      "Uploading...";
  }

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

    if (status) {
      status.textContent =
        "Upload complete.";
    }

    setTimeout(
      () => {
        closeModal();
        loadProjects();
      },
      700
    );

  } catch (error) {

    if (status) {
      status.textContent =
        error.message;
    }
  }
}

async function showLogs(
  id
) {

  const element =
    document.getElementById(
      `logs-${id}`
    );

  if (!element) return;

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

async function deleteProject(
  id
) {

  const confirmed =
    confirm(
      "Delete this project and all of its files?"
    );

  if (!confirmed) {
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

function escapeHTML(
  value
) {

  return String(value)
    .replaceAll(
      "&",
      "&amp;"
    )
    .replaceAll(
      "<",
      "&lt;"
    )
    .replaceAll(
      ">",
      "&gt;"
    )
    .replaceAll(
      '"',
      "&quot;"
    )
    .replaceAll(
      "'",
      "&#039;"
    );
}

function escapeAttribute(
  value
) {

  return String(value)
    .replaceAll(
      "\\",
      "\\\\"
    )
    .replaceAll(
      "'",
      "\\'"
    )
    .replaceAll(
      '"',
      "&quot;"
    );
}
