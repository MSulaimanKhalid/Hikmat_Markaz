document.addEventListener("DOMContentLoaded", () => {
    const isLocalFrontend =
        window.location.hostname === "127.0.0.1" ||
        window.location.hostname === "localhost" ||
        window.location.protocol === "file:";

    const API_BASE_URL = isLocalFrontend
        ? window.HM_CONFIG.LOCAL_API_URL
        : window.HM_CONFIG.PRODUCTION_API_URL;

    const form = document.getElementById("patientSignupForm");
    const resultBox = document.getElementById("patientSignupResult");

    const cnic = document.getElementById("patientSignupCnic");
    const name = document.getElementById("patientSignupName");
    const gender = document.getElementById("patientSignupGender");
    const dob = document.getElementById("patientSignupDob");
    const phone = document.getElementById("patientSignupPhone");
    const email = document.getElementById("patientSignupEmail");
    const password = document.getElementById("patientSignupPassword");
    const confirmPassword = document.getElementById("patientSignupConfirmPassword");

    function showMessage(message, type) {
        resultBox.textContent = message;
        resultBox.classList.remove("ok", "error", "pending");

        if (type) {
            resultBox.classList.add(type);
        }
    }

    async function submitSignup(event) {
        event.preventDefault();

        if (password.value.length < 8) {
            showMessage("Password must be at least 8 characters long.", "error");
            return;
        }

        if (password.value !== confirmPassword.value) {
            showMessage("Passwords do not match.", "error");
            return;
        }

        const payload = {
            cnic: cnic.value.trim(),
            name: name.value.trim(),
            gender: gender.value,
            dob: dob.value,
            phone: phone.value.trim(),
            email: email.value.trim(),
            password: password.value
        };

        try {
            showMessage("Creating patient account...", "pending");

            const response = await fetch(`${API_BASE_URL}/api/patient/signup`, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json"
                },
                body: JSON.stringify(payload)
            });

            const result = await response.json();

            if (!response.ok) {
                throw new Error(result.error || result.message || "Patient signup failed.");
            }

            showMessage(result.message + " Redirecting to login...", "ok");
            form.reset();

            setTimeout(() => {
                window.location.href = "./index.html";
            }, 1400);

        } catch (error) {
            showMessage(error.message, "error");
        }
    }

    form.addEventListener("submit", submitSignup);
});