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

    const loginForm = document.getElementById("loginForm");
    const loginEmail = document.getElementById("loginEmail");
    const loginPassword = document.getElementById("loginPassword");
    const loginResult = document.getElementById("loginResult");

    const userBox = document.getElementById("userBox");
    const loggedInRole = document.getElementById("loggedInRole");
    const loggedInEmail = document.getElementById("loggedInEmail");
    const logoutButton = document.getElementById("logoutButton");

    function setStatus(element, text, type) {
        element.textContent = text;
        element.classList.remove("ok", "error", "pending");

        if (type) {
            element.classList.add(type);
        }
    }

    function showLoginMessage(message, type) {
        loginResult.textContent = message;
        loginResult.classList.remove("ok", "error", "pending");

        if (type) {
            loginResult.classList.add(type);
        }
    }

    function saveSession(token, user) {
        localStorage.setItem("hm_token", token);
        localStorage.setItem("hm_user", JSON.stringify(user));
    }

    function getSavedUser() {
        const user = localStorage.getItem("hm_user");
        return user ? JSON.parse(user) : null;
    }

    function clearSession() {
        localStorage.removeItem("hm_token");
        localStorage.removeItem("hm_user");
    }

    function renderSession() {
        const user = getSavedUser();

        if (!user) {
            userBox.classList.add("hidden");
            return;
        }

        loggedInRole.textContent = user.role;
        loggedInEmail.textContent = user.email || "No email";
        userBox.classList.remove("hidden");
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

    async function loginUser(event) {
        event.preventDefault();

        showLoginMessage("Logging in...", "pending");

        const payload = {
            email: loginEmail.value.trim(),
            password: loginPassword.value
        };

        try {
            const response = await fetch(`${API_BASE_URL}/api/auth/login`, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json"
                },
                body: JSON.stringify(payload)
            });

            const result = await response.json();

            if (!response.ok) {
                throw new Error(result.message || "Login failed");
            }

            saveSession(result.token, result.user);
            renderSession();

            showLoginMessage(`Login successful. Role: ${result.user.role}`, "ok");

            loginPassword.value = "";

        } catch (error) {
            showLoginMessage(error.message, "error");
        }
    }

    function logoutUser() {
        clearSession();
        renderSession();
        showLoginMessage("Logged out successfully.", "ok");
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

    loginForm.addEventListener("submit", loginUser);
    logoutButton.addEventListener("click", logoutUser);

    renderSession();
    runAllChecks();

    setInterval(() => {
        checkSync();
    }, 30000);
});