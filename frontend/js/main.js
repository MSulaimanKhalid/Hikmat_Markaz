document.addEventListener("DOMContentLoaded", () => {
    const isLocalFrontend =
        window.location.hostname === "127.0.0.1" ||
        window.location.hostname === "localhost" ||
        window.location.protocol === "file:";

    const API_BASE_URL = isLocalFrontend
        ? window.HM_CONFIG.LOCAL_API_URL
        : window.HM_CONFIG.PRODUCTION_API_URL;

    const backendStatus = document.getElementById("backendStatus");
    const backendMessage = document.getElementById("backendMessage");

    const dbStatus = document.getElementById("dbStatus");
    const dbMessage = document.getElementById("dbMessage");

    const syncStatus = document.getElementById("syncStatus");
    const syncMessage = document.getElementById("syncMessage");

    const refreshButton = document.getElementById("refreshButton");

    function setStatus(element, text, type) {
        element.textContent = text;
        element.classList.remove("ok", "error", "pending");

        if (type) {
            element.classList.add(type);
        }
    }

    async function checkBackend() {
        try {
            const response = await fetch(`${API_BASE_URL}/api/health`);
            const result = await response.json();

            if (!response.ok) {
                throw new Error(result.message || "Backend error");
            }

            setStatus(backendStatus, "Online", "ok");
            backendMessage.textContent = result.message;
        } catch (error) {
            setStatus(backendStatus, "Offline", "error");
            backendMessage.textContent = error.message;
        }
    }

    async function checkDatabase() {
        try {
            const response = await fetch(`${API_BASE_URL}/api/health/db`);
            const result = await response.json();

            if (!response.ok) {
                throw new Error(result.error || result.message || "Database error");
            }

            setStatus(dbStatus, "Connected", "ok");
            dbMessage.textContent = `${result.database.database_name} / ${result.database.schema_name}`;
        } catch (error) {
            setStatus(dbStatus, "Failed", "error");
            dbMessage.textContent = error.message;
        }
    }

    async function checkSync() {
        try {
            const response = await fetch(`${API_BASE_URL}/api/sync/ping`);
            const result = await response.json();

            if (!response.ok) {
                throw new Error(result.error || result.message || "Sync error");
            }

            setStatus(syncStatus, "Active", "ok");
            syncMessage.textContent = `Last checked: ${new Date().toLocaleTimeString()}`;
        } catch (error) {
            setStatus(syncStatus, "Failed", "error");
            syncMessage.textContent = error.message;
        }
    }

    function runAllChecks() {
        setStatus(backendStatus, "Checking...", "pending");
        backendMessage.textContent = `Calling ${API_BASE_URL}`;

        setStatus(dbStatus, "Checking...", "pending");
        dbMessage.textContent = "Checking database connection";

        setStatus(syncStatus, "Checking...", "pending");
        syncMessage.textContent = "Checking sync endpoint";

        checkBackend();
        checkDatabase();
        checkSync();
    }

    refreshButton.addEventListener("click", runAllChecks);

    runAllChecks();

    setInterval(() => {
        checkSync();
    }, 30000);
});