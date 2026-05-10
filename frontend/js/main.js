document.addEventListener("DOMContentLoaded", () => {
    const isLocalFrontend =
        window.location.hostname === "127.0.0.1" ||
        window.location.hostname === "localhost" ||
        window.location.protocol === "file:";

    const API_BASE_URL = isLocalFrontend
        ? window.HM_CONFIG.LOCAL_API_URL
        : window.HM_CONFIG.PRODUCTION_API_URL;

    const loginForm = document.getElementById("loginForm");
    const loginEmail = document.getElementById("loginEmail");
    const loginPassword = document.getElementById("loginPassword");
    const loginResult = document.getElementById("loginResult");

    const backendStatusDot = document.getElementById("backendStatusDot");
    const backendStatusText = document.getElementById("backendStatusText");

    const databaseStatusDot = document.getElementById("databaseStatusDot");
    const databaseStatusText = document.getElementById("databaseStatusText");

    const syncStatusDot = document.getElementById("syncStatusDot");
    const syncStatusText = document.getElementById("syncStatusText");

    function setStatus(dot, textElement, status, message) {
        if (!dot || !textElement) {
            return;
        }

        dot.classList.remove("ok", "error", "pending");

        if (status) {
            dot.classList.add(status);
        }

        textElement.textContent = message;
    }

    function showLoginMessage(message, type) {
        if (!loginResult) {
            return;
        }

        loginResult.textContent = message;
        loginResult.classList.remove("ok", "error", "pending");

        if (type) {
            loginResult.classList.add(type);
        }
    }

    async function checkBackendHealth() {
        try {
            setStatus(
                backendStatusDot,
                backendStatusText,
                "pending",
                "Checking backend connection..."
            );

            const response = await fetch(`${API_BASE_URL}/api/health`);
            const result = await response.json();

            if (!response.ok) {
                throw new Error(result.message || "Backend check failed.");
            }

            setStatus(
                backendStatusDot,
                backendStatusText,
                "ok",
                result.message || "Backend server is running."
            );
        } catch (error) {
            setStatus(
                backendStatusDot,
                backendStatusText,
                "error",
                "Backend server is not reachable."
            );
        }
    }

    async function checkDatabaseHealth() {
        try {
            setStatus(
                databaseStatusDot,
                databaseStatusText,
                "pending",
                "Checking database connection..."
            );

            const response = await fetch(`${API_BASE_URL}/api/health/db`);
            const result = await response.json();

            if (!response.ok) {
                throw new Error(result.message || "Database check failed.");
            }

            setStatus(
                databaseStatusDot,
                databaseStatusText,
                "ok",
                "Database connection successful."
            );
        } catch (error) {
            setStatus(
                databaseStatusDot,
                databaseStatusText,
                "error",
                "Database connection failed."
            );
        }
    }

    async function checkSync() {
        try {
            setStatus(
                syncStatusDot,
                syncStatusText,
                "pending",
                "Checking live sync..."
            );

            const response = await fetch(`${API_BASE_URL}/api/sync/ping`);
            const result = await response.json();

            if (!response.ok) {
                throw new Error(result.message || "Sync check failed.");
            }

            setStatus(
                syncStatusDot,
                syncStatusText,
                "ok",
                "Live sync endpoint is active."
            );
        } catch (error) {
            setStatus(
                syncStatusDot,
                syncStatusText,
                "error",
                "Live sync endpoint failed."
            );
        }
    }

    async function loginUser(event) {
        event.preventDefault();

        const email = loginEmail.value.trim().toLowerCase();
        const password = loginPassword.value;

        if (!email || !password) {
            showLoginMessage("Email and password are required.", "error");
            return;
        }

        try {
            showLoginMessage("Logging in...", "pending");

            const response = await fetch(`${API_BASE_URL}/api/auth/login`, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json"
                },
                body: JSON.stringify({
                    email,
                    password
                })
            });

            const result = await response.json();

            if (!response.ok) {
                throw new Error(result.message || "Login failed.");
            }

            localStorage.setItem("hm_token", result.token);
            localStorage.setItem("hm_user", JSON.stringify(result.user));

            showLoginMessage("Login successful. Redirecting...", "ok");

            setTimeout(() => {
                window.location.href = "./dashboard.html";
            }, 600);
        } catch (error) {
            showLoginMessage(error.message, "error");
        }
    }

    if (loginForm) {
        loginForm.addEventListener("submit", loginUser);
    }

    checkBackendHealth();
    checkDatabaseHealth();
    checkSync();

    setInterval(() => {
        checkSync();
    }, 30000);
});