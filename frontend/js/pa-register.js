document.addEventListener("DOMContentLoaded", () => {
    const isLocalFrontend =
        window.location.hostname === "127.0.0.1" ||
        window.location.hostname === "localhost" ||
        window.location.protocol === "file:";

    const API_BASE_URL = isLocalFrontend
        ? window.HM_CONFIG.LOCAL_API_URL
        : window.HM_CONFIG.PRODUCTION_API_URL;

    const params = new URLSearchParams(window.location.search);
    const inviteToken = params.get("token");

    const inviteStatusBox = document.getElementById("inviteStatusBox");
    const paRegisterForm = document.getElementById("paRegisterForm");
    const registerResult = document.getElementById("registerResult");

    const inviteDoctorName = document.getElementById("inviteDoctorName");
    const inviteHospitalName = document.getElementById("inviteHospitalName");
    const registerCnic = document.getElementById("registerCnic");
    const registerEmail = document.getElementById("registerEmail");
    const registerFullName = document.getElementById("registerFullName");
    const registerPhone = document.getElementById("registerPhone");
    const registerPassword = document.getElementById("registerPassword");
    const registerConfirmPassword = document.getElementById("registerConfirmPassword");

    let inviteData = null;

    function showMessage(element, message, type) {
        if (!element) {
            return;
        }

        element.textContent = message;
        element.classList.remove("ok", "error", "pending");

        if (type) {
            element.classList.add(type);
        }
    }

    async function fetchInvite() {
        if (!inviteToken) {
            showMessage(inviteStatusBox, "Invite token is missing from the link.", "error");
            return;
        }

        try {
            showMessage(inviteStatusBox, "Loading invite details...", "pending");

            const response = await fetch(`${API_BASE_URL}/api/pa/invites/${inviteToken}`);
            const result = await response.json();

            if (!response.ok) {
                throw new Error(result.message || "Invite not found.");
            }

            inviteData = result.data;

            if (inviteData.status !== "pending") {
                showMessage(inviteStatusBox, `This invite is already ${inviteData.status}.`, "error");
                return;
            }

            inviteDoctorName.value = `${inviteData.doctor_name} (${inviteData.specialization || "Doctor"})`;
            inviteHospitalName.value = `${inviteData.hospital_name} - ${inviteData.hospital_city || ""}`;
            registerCnic.value = inviteData.invited_cnic;
            registerEmail.value = inviteData.invited_email;

            paRegisterForm.classList.remove("hidden");

            showMessage(
                inviteStatusBox,
                `You have been invited by ${inviteData.doctor_name} for ${inviteData.hospital_name}.`,
                "ok"
            );

        } catch (error) {
            showMessage(inviteStatusBox, error.message, "error");
        }
    }

    async function submitRegistration(event) {
        event.preventDefault();

        if (!inviteData) {
            showMessage(registerResult, "Invite data is not loaded.", "error");
            return;
        }

        const password = registerPassword.value;
        const confirmPassword = registerConfirmPassword.value;

        if (password.length < 8) {
            showMessage(registerResult, "Password must be at least 8 characters long.", "error");
            return;
        }

        if (password !== confirmPassword) {
            showMessage(registerResult, "Passwords do not match.", "error");
            return;
        }

        const payload = {
            full_name: registerFullName.value.trim(),
            phone: registerPhone.value.trim(),
            email: registerEmail.value.trim(),
            password: password
        };

        try {
            showMessage(registerResult, "Completing registration...", "pending");

            const response = await fetch(`${API_BASE_URL}/api/pa/invites/${inviteToken}/accept`, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json"
                },
                body: JSON.stringify(payload)
            });

            const result = await response.json();

            if (!response.ok) {
                throw new Error(result.message || "Registration failed.");
            }

            showMessage(registerResult, result.message, "ok");
            paRegisterForm.reset();
            paRegisterForm.classList.add("hidden");

            setTimeout(() => {
                window.location.href = "./index.html";
            }, 1500);

        } catch (error) {
            showMessage(registerResult, error.message, "error");
        }
    }

    paRegisterForm.addEventListener("submit", submitRegistration);

    fetchInvite();
});