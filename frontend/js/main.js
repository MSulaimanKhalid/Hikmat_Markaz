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

    const loginTab = document.getElementById("loginTab");
    const signupTab = document.getElementById("signupTab");
    const loginSection = document.getElementById("loginSection");
    const signupSection = document.getElementById("signupSection");

    const loginForm = document.getElementById("loginForm");
    const loginEmail = document.getElementById("loginEmail");
    const loginPassword = document.getElementById("loginPassword");
    const loginResult = document.getElementById("loginResult");

    const userBox = document.getElementById("userBox");
    const loggedInRole = document.getElementById("loggedInRole");
    const loggedInEmail = document.getElementById("loggedInEmail");
    const logoutButton = document.getElementById("logoutButton");

    const doctorSignupForm = document.getElementById("doctorSignupForm");
    const signupResult = document.getElementById("signupResult");

    const signupName = document.getElementById("signupName");
    const signupSpecialization = document.getElementById("signupSpecialization");
    const signupLicense = document.getElementById("signupLicense");
    const signupEmail = document.getElementById("signupEmail");
    const signupPhone = document.getElementById("signupPhone");
    const signupPassword = document.getElementById("signupPassword");
    const signupConfirmPassword = document.getElementById("signupConfirmPassword");

    function setStatus(element, text, type) {
        element.textContent = text;
        element.classList.remove("ok", "error", "pending");

        if (type) {
            element.classList.add(type);
        }
    }

    function showMessage(element, message, type) {
        element.textContent = message;
        element.classList.remove("ok", "error", "pending");

        if (type) {
            element.classList.add(type);
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

    function showLoginTab() {
        loginTab.classList.add("active");
        signupTab.classList.remove("active");
        loginSection.classList.remove("hidden");
        signupSection.classList.add("hidden");
    }

    function showSignupTab() {
        signupTab.classList.add("active");
        loginTab.classList.remove("active");
        signupSection.classList.remove("hidden");
        loginSection.classList.add("hidden");
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

        showMessage(loginResult, "Logging in...", "pending");

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

            showMessage(loginResult, `Login successful. Role: ${result.user.role}`, "ok");

            loginPassword.value = "";

        } catch (error) {
            showMessage(loginResult, error.message, "error");
        }
    }

    async function submitDoctorSignup(event) {
        event.preventDefault();

        showMessage(signupResult, "Submitting signup request...", "pending");

        const password = signupPassword.value;
        const confirmPassword = signupConfirmPassword.value;

        if (password.length < 8) {
            showMessage(signupResult, "Password must be at least 8 characters long.", "error");
            return;
        }

        if (password !== confirmPassword) {
            showMessage(signupResult, "Passwords do not match.", "error");
            return;
        }

        const payload = {
            name: signupName.value.trim(),
            specialization: signupSpecialization.value.trim(),
            license_number: signupLicense.value.trim(),
            email: signupEmail.value.trim(),
            phone: signupPhone.value.trim(),
            password: password
        };

        try {
            const response = await fetch(`${API_BASE_URL}/api/doctors/signup`, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json"
                },
                body: JSON.stringify(payload)
            });

            const result = await response.json();

            if (!response.ok) {
                throw new Error(result.message || "Signup failed");
            }

            showMessage(signupResult, result.message, "ok");
            doctorSignupForm.reset();

            setTimeout(() => {
                showLoginTab();
                showMessage(loginResult, "Signup request submitted. Login will work after admin approval.", "pending");
            }, 1200);

        } catch (error) {
            showMessage(signupResult, error.message, "error");
        }
    }

    function logoutUser() {
        clearSession();
        renderSession();
        showMessage(loginResult, "Logged out successfully.", "ok");
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

    loginTab.addEventListener("click", showLoginTab);
    signupTab.addEventListener("click", showSignupTab);

    loginForm.addEventListener("submit", loginUser);
    doctorSignupForm.addEventListener("submit", submitDoctorSignup);
    logoutButton.addEventListener("click", logoutUser);

    renderSession();
    runAllChecks();

    setInterval(() => {
        checkSync();
    }, 30000);
});