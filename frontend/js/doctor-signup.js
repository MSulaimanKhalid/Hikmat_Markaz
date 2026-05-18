document.addEventListener("DOMContentLoaded", () => {
    const isLocalFrontend =
        window.location.hostname === "127.0.0.1" ||
        window.location.hostname === "localhost" ||
        window.location.protocol === "file:";

    const API_BASE_URL =
        window.HM_CONFIG && window.HM_CONFIG.LOCAL_API_URL && window.HM_CONFIG.PRODUCTION_API_URL
            ? (
                isLocalFrontend
                    ? window.HM_CONFIG.LOCAL_API_URL
                    : window.HM_CONFIG.PRODUCTION_API_URL
            )
            : "http://127.0.0.1:5000";

    const form = document.getElementById("doctorSignupForm");
    const resultBox = document.getElementById("doctorSignupResult");

    const nameInput = document.getElementById("doctorSignupName");
    const cnicInput = document.getElementById("doctorSignupCnic");
    const emailInput = document.getElementById("doctorSignupEmail");
    const phoneInput = document.getElementById("doctorSignupPhone");
    const specializationInput = document.getElementById("doctorSignupSpecialization");
    const licenseInput = document.getElementById("doctorSignupLicense");
    const passwordInput = document.getElementById("doctorSignupPassword");
    const confirmPasswordInput = document.getElementById("doctorSignupConfirmPassword");

    function showMessage(message, type) {
        resultBox.textContent = message;
        resultBox.classList.remove("ok", "error", "pending");

        if (type) {
            resultBox.classList.add(type);
        }
    }

    function normalizeCnic(value) {
        return String(value || "").replace(/\D/g, "").slice(0, 13);
    }

    function normalizePhone(value) {
        return String(value || "").replace(/\D/g, "").slice(0, 11);
    }

    if (cnicInput) {
        cnicInput.addEventListener("input", () => {
            cnicInput.value = normalizeCnic(cnicInput.value);
        });
    }

    if (phoneInput) {
        phoneInput.addEventListener("input", () => {
            phoneInput.value = normalizePhone(phoneInput.value);
        });
    }

    async function submitDoctorRequest(event) {
        event.preventDefault();

        const name = nameInput.value.trim();
        const cnic = normalizeCnic(cnicInput.value);
        const email = emailInput.value.trim().toLowerCase();
        const phone = normalizePhone(phoneInput.value);
        const specialization = specializationInput.value.trim();
        const licenseNumber = licenseInput.value.trim();
        const password = passwordInput.value;
        const confirmPassword = confirmPasswordInput.value;

        if (!name || !email || !specialization || !licenseNumber || !password) {
            showMessage("Please fill all required fields.", "error");
            return;
        }

        if (cnic && !/^[0-9]{13}$/.test(cnic)) {
            showMessage("CNIC must be exactly 13 digits.", "error");
            return;
        }

        if (phone && !/^03[0-9]{9}$/.test(phone)) {
            showMessage("Phone must be in format 03XXXXXXXXX.", "error");
            return;
        }

        if (password.length < 8) {
            showMessage("Password must be at least 8 characters long.", "error");
            return;
        }

        if (password !== confirmPassword) {
            showMessage("Passwords do not match.", "error");
            return;
        }

        const payload = {
            name: name,
            cnic: cnic,
            email: email,
            phone: phone,
            specialization: specialization,
            license_number: licenseNumber,
            password: password
        };

        try {
            showMessage("Submitting doctor request...", "pending");

            const response = await fetch(`${API_BASE_URL}/api/doctors/signup`, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json"
                },
                body: JSON.stringify(payload)
            });

            const result = await response.json();

            if (!response.ok) {
                throw new Error(result.error || result.message || "Doctor signup request failed.");
            }

            showMessage(result.message || "Doctor request submitted successfully.", "ok");
            form.reset();

            setTimeout(() => {
                window.location.href = "./index.html";
            }, 1600);

        } catch (error) {
            showMessage(error.message, "error");
        }
    }

    form.addEventListener("submit", submitDoctorRequest);
});