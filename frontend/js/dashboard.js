document.addEventListener("DOMContentLoaded", () => {
    const isLocalFrontend =
        window.location.hostname === "127.0.0.1" ||
        window.location.hostname === "localhost" ||
        window.location.protocol === "file:";

    const API_BASE_URL = isLocalFrontend
        ? window.HM_CONFIG.LOCAL_API_URL
        : window.HM_CONFIG.PRODUCTION_API_URL;

    const token = localStorage.getItem("hm_token");
    const userRaw = localStorage.getItem("hm_user");

    if (!token || !userRaw) {
        window.location.href = "./index.html";
        return;
    }

    const user = JSON.parse(userRaw);

    const dashboardTitle = document.getElementById("dashboardTitle");
    const dashboardSubtitle = document.getElementById("dashboardSubtitle");
    const loggedInRole = document.getElementById("loggedInRole");
    const loggedInEmail = document.getElementById("loggedInEmail");
    const logoutButton = document.getElementById("logoutButton");

    const adminDashboard = document.getElementById("adminDashboard");
    const doctorDashboard = document.getElementById("doctorDashboard");
    const paDashboard = document.getElementById("paDashboard");
    const patientDashboard = document.getElementById("patientDashboard");

    const refreshPendingDoctorsButton = document.getElementById("refreshPendingDoctorsButton");
    const pendingDoctorsList = document.getElementById("pendingDoctorsList");
    const adminMessage = document.getElementById("adminMessage");

    const pendingDoctorsCount = document.getElementById("pendingDoctorsCount");
    const approvedDoctorsCount = document.getElementById("approvedDoctorsCount");
    const rejectedDoctorsCount = document.getElementById("rejectedDoctorsCount");

    function showMessage(element, message, type) {
        element.textContent = message;
        element.classList.remove("ok", "error", "pending");

        if (type) {
            element.classList.add(type);
        }
    }

    async function apiRequest(path, options = {}) {
        const headers = options.headers || {};

        headers["Authorization"] = `Bearer ${token}`;

        const response = await fetch(`${API_BASE_URL}${path}`, {
            ...options,
            headers
        });

        const result = await response.json();

        if (!response.ok) {
            throw new Error(result.message || "Request failed");
        }

        return result;
    }

    function logout() {
        localStorage.removeItem("hm_token");
        localStorage.removeItem("hm_user");
        window.location.href = "./index.html";
    }

    function hideAllDashboards() {
        adminDashboard.classList.add("hidden");
        doctorDashboard.classList.add("hidden");
        paDashboard.classList.add("hidden");
        patientDashboard.classList.add("hidden");
    }

    function renderDashboardByRole() {
        loggedInRole.textContent = user.role;
        loggedInEmail.textContent = user.email || "No email";

        dashboardTitle.textContent = `${capitalize(user.role)} Dashboard`;
        dashboardSubtitle.textContent = `Welcome back, ${user.email || "user"}.`;

        hideAllDashboards();

        if (user.role === "admin") {
            adminDashboard.classList.remove("hidden");
            loadAdminDashboard();
        }

        if (user.role === "doctor") {
            doctorDashboard.classList.remove("hidden");
        }

        if (user.role === "pa") {
            paDashboard.classList.remove("hidden");
        }

        if (user.role === "patient") {
            patientDashboard.classList.remove("hidden");
        }
    }

    function capitalize(value) {
        if (!value) {
            return "";
        }

        return value.charAt(0).toUpperCase() + value.slice(1);
    }

    async function verifySession() {
        try {
            await apiRequest("/api/auth/me");
        } catch (error) {
            logout();
        }
    }

    async function loadAdminSummary() {
        const result = await apiRequest("/api/admin/dashboard-summary");

        pendingDoctorsCount.textContent = result.data.pending_doctors || 0;
        approvedDoctorsCount.textContent = result.data.approved_doctors || 0;
        rejectedDoctorsCount.textContent = result.data.rejected_doctors || 0;
    }

    async function loadPendingDoctors() {
        showMessage(adminMessage, "Loading pending doctor requests...", "pending");

        const result = await apiRequest("/api/admin/doctors/pending");
        const doctors = result.data || [];

        if (doctors.length === 0) {
            pendingDoctorsList.innerHTML = `<p class="muted-text">No pending doctor requests.</p>`;
            showMessage(adminMessage, "No pending requests found.", "ok");
            return;
        }

        pendingDoctorsList.innerHTML = doctors.map((doctor) => {
            return `
                <div class="doctor-card" data-doctor-id="${doctor.doctor_id}">
                    <h4>${doctor.name}</h4>

                    <div class="doctor-meta">
                        <span><strong>Specialization:</strong> ${doctor.specialization}</span>
                        <span><strong>License:</strong> ${doctor.license_number}</span>
                        <span><strong>Email:</strong> ${doctor.email}</span>
                        <span><strong>Phone:</strong> ${doctor.phone || "Not provided"}</span>
                        <span><strong>Status:</strong> ${doctor.approval_status}</span>
                    </div>

                    <textarea
                        class="reject-reason"
                        placeholder="Write rejection reason if you want to reject this request"
                    ></textarea>

                    <div class="doctor-actions">
                        <button type="button" class="approve-doctor-button">
                            Approve
                        </button>

                        <button type="button" class="danger-button reject-doctor-button">
                            Reject
                        </button>
                    </div>
                </div>
            `;
        }).join("");

        showMessage(adminMessage, `${doctors.length} pending request(s) loaded.`, "ok");
    }

    async function loadAdminDashboard() {
        try {
            await loadAdminSummary();
            await loadPendingDoctors();
        } catch (error) {
            showMessage(adminMessage, error.message, "error");
        }
    }

    async function approveDoctor(doctorId) {
        try {
            showMessage(adminMessage, "Approving doctor...", "pending");

            const result = await apiRequest(`/api/admin/doctors/${doctorId}/approve`, {
                method: "POST"
            });

            showMessage(adminMessage, result.message, "ok");
            await loadAdminDashboard();
        } catch (error) {
            showMessage(adminMessage, error.message, "error");
        }
    }

    async function rejectDoctor(doctorId, reason) {
        if (!reason.trim()) {
            showMessage(adminMessage, "Rejection reason is required.", "error");
            return;
        }

        try {
            showMessage(adminMessage, "Rejecting doctor request...", "pending");

            const result = await apiRequest(`/api/admin/doctors/${doctorId}/reject`, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json"
                },
                body: JSON.stringify({
                    rejection_reason: reason.trim()
                })
            });

            showMessage(adminMessage, result.message, "ok");
            await loadAdminDashboard();
        } catch (error) {
            showMessage(adminMessage, error.message, "error");
        }
    }

    function handleDoctorListClick(event) {
        const card = event.target.closest(".doctor-card");

        if (!card) {
            return;
        }

        const doctorId = card.getAttribute("data-doctor-id");
        const rejectReason = card.querySelector(".reject-reason");

        if (event.target.classList.contains("approve-doctor-button")) {
            approveDoctor(doctorId);
        }

        if (event.target.classList.contains("reject-doctor-button")) {
            rejectDoctor(doctorId, rejectReason.value);
        }
    }

    logoutButton.addEventListener("click", logout);

    if (refreshPendingDoctorsButton) {
        refreshPendingDoctorsButton.addEventListener("click", loadAdminDashboard);
    }

    if (pendingDoctorsList) {
        pendingDoctorsList.addEventListener("click", handleDoctorListClick);
    }

    verifySession();
    renderDashboardByRole();

    setInterval(() => {
        if (user.role === "admin") {
            loadAdminSummary();
        }
    }, 30000);
});