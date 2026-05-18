document.addEventListener("DOMContentLoaded", () => {
    const isLocalFrontend =
        window.location.hostname === "127.0.0.1" ||
        window.location.hostname === "localhost" ||
        window.location.protocol === "file:";

    const API_BASE_URL = isLocalFrontend
        ? window.HM_CONFIG.LOCAL_API_URL
        : window.HM_CONFIG.PRODUCTION_API_URL;

    let loginMode = "staff";

    const loginForm = document.getElementById("loginForm");
    const loginEmail = document.getElementById("loginEmail");
    const loginCnic = document.getElementById("loginCnic");
    const loginPassword = document.getElementById("loginPassword");
    const loginResult = document.getElementById("loginResult");

    const staffLoginFields = document.getElementById("staffLoginFields");
    const patientLoginFields = document.getElementById("patientLoginFields");
    const staffLoginModeButton = document.getElementById("staffLoginModeButton");
    const patientLoginModeButton = document.getElementById("patientLoginModeButton");

    const backendStatusDot = document.getElementById("backendStatusDot");
    const backendStatusText = document.getElementById("backendStatusText");

    const databaseStatusDot = document.getElementById("databaseStatusDot");
    const databaseStatusText = document.getElementById("databaseStatusText");

    const syncStatusDot = document.getElementById("syncStatusDot");
    const syncStatusText = document.getElementById("syncStatusText");

    function normalizeCnic(value) {
        return String(value || "").replace(/\D/g, "").slice(0, 13);
    }

    function isValidCnic(value) {
        return /^[0-9]{13}$/.test(value);
    }

    function setLoginMode(mode) {
        loginMode = mode;

        if (mode === "staff") {
            staffLoginFields.classList.remove("hidden");
            patientLoginFields.classList.add("hidden");

            staffLoginModeButton.classList.add("active");
            patientLoginModeButton.classList.remove("active");

            loginEmail.required = true;
            loginCnic.required = false;
        } else {
            staffLoginFields.classList.add("hidden");
            patientLoginFields.classList.remove("hidden");

            staffLoginModeButton.classList.remove("active");
            patientLoginModeButton.classList.add("active");

            loginEmail.required = false;
            loginCnic.required = true;
        }

        showLoginMessage("", "");
    }

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

        const password = loginPassword.value;

        if (!password) {
            showLoginMessage("Password is required.", "error");
            return;
        }

        try {
            showLoginMessage("Logging in...", "pending");

            let response;

            if (loginMode === "staff") {
                const email = loginEmail.value.trim().toLowerCase();

                if (!email) {
                    showLoginMessage("Email is required.", "error");
                    return;
                }

                response = await fetch(`${API_BASE_URL}/api/auth/login`, {
                    method: "POST",
                    headers: {
                        "Content-Type": "application/json"
                    },
                    body: JSON.stringify({
                        email,
                        password
                    })
                });
            } else {
                const cnic = normalizeCnic(loginCnic.value);

                if (!isValidCnic(cnic)) {
                    showLoginMessage("Patient CNIC must be exactly 13 digits.", "error");
                    return;
                }

                response = await fetch(`${API_BASE_URL}/api/patient/login`, {
                    method: "POST",
                    headers: {
                        "Content-Type": "application/json"
                    },
                    body: JSON.stringify({
                        cnic,
                        password
                    })
                });
            }

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

    if (staffLoginModeButton) {
        staffLoginModeButton.addEventListener("click", () => {
            setLoginMode("staff");
        });
    }

    if (patientLoginModeButton) {
        patientLoginModeButton.addEventListener("click", () => {
            setLoginMode("patient");
        });
    }

    if (loginCnic) {
        loginCnic.addEventListener("input", () => {
            loginCnic.value = normalizeCnic(loginCnic.value);
        });
    }

    setLoginMode("staff");

    checkBackendHealth();
    checkDatabaseHealth();
    checkSync();

    setInterval(() => {
        checkSync();
    }, 30000);
});