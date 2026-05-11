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

    const dashboardTitle = document.getElementById("dashboardTitle");
    const dashboardSubtitle = document.getElementById("dashboardSubtitle");
    const dashboardMessage = document.getElementById("dashboardMessage");

    const loggedInEmail = document.getElementById("loggedInEmail");
    const loggedInRole = document.getElementById("loggedInRole");
    const logoutButton = document.getElementById("logoutButton");

    const adminDashboard = document.getElementById("adminDashboard");
    const doctorDashboard = document.getElementById("doctorDashboard");
    const paDashboard = document.getElementById("paDashboard");
    const patientDashboard = document.getElementById("patientDashboard");

    let currentUser = null;
    let doctorSettingsCache = {
        hospitals: [],
        schedules: [],
        formFields: [],
        paLinks: [],
        paInvites: []
    };

    let paWorkspaceCache = {
        assignments: [],
        selectedSlot: null
    };

    function getToken() {
        return localStorage.getItem("hm_token");
    }

    function getStoredUser() {
        try {
            return JSON.parse(localStorage.getItem("hm_user") || "null");
        } catch (error) {
            return null;
        }
    }

    function saveSession(token, user) {
        if (token) {
            localStorage.setItem("hm_token", token);
        }

        if (user) {
            localStorage.setItem("hm_user", JSON.stringify(user));
        }
    }

    function clearSession() {
        localStorage.removeItem("hm_token");
        localStorage.removeItem("hm_user");
    }

    function redirectToLogin() {
        clearSession();
        window.location.href = "./index.html";
    }

    function showMessage(message, type) {
        if (!dashboardMessage) {
            return;
        }

        dashboardMessage.textContent = message || "";
        dashboardMessage.classList.remove("ok", "error", "pending");

        if (type) {
            dashboardMessage.classList.add(type);
        }
    }

    function hideAllDashboards() {
        [
            adminDashboard,
            doctorDashboard,
            paDashboard,
            patientDashboard
        ].forEach((dashboard) => {
            if (dashboard) {
                dashboard.classList.add("hidden");
            }
        });
    }

    function setDashboardHeader(user) {
    const role = user.role || "user";
    const email = user.email || user.cnic || "Logged in user";

    if (loggedInEmail) {
    loggedInEmail.textContent = user.email || user.cnic || role;
    }

    if (loggedInRole) {
    loggedInRole.textContent = role.toUpperCase();
    }

    if (dashboardTitle) {
        if (role === "admin") {
            dashboardTitle.textContent = "Admin Dashboard";
        } else if (role === "doctor") {
            dashboardTitle.textContent = "Doctor Dashboard";
        } else if (role === "pa") {
            dashboardTitle.textContent = "PA Dashboard";
        } else if (role === "patient") {
            dashboardTitle.textContent = "Patient Portal";
        } else {
            dashboardTitle.textContent = "Dashboard";
        }
    }

    if (dashboardSubtitle) {
        if (role === "admin") {
            dashboardSubtitle.textContent = "Review and manage doctor signup requests.";
        } else if (role === "doctor") {
            dashboardSubtitle.textContent = "Manage settings, queue, appointments, and finance.";
        } else if (role === "pa") {
            dashboardSubtitle.textContent = "Manage bookings, payments, prescriptions, and online requests.";
        } else if (role === "patient") {
            dashboardSubtitle.textContent = "View appointments, prescriptions, and request appointments.";
        } else {
            dashboardSubtitle.textContent = "Welcome to Hikmat Markaz.";
        }
    }
}
    async function apiRequest(path, options = {}) {
        const token = getToken();

        if (!token) {
            redirectToLogin();
            throw new Error("Login session expired.");
        }

        const headers = {
            ...(options.headers || {}),
            "Authorization": `Bearer ${token}`
        };

        const response = await fetch(`${API_BASE_URL}${path}`, {
            ...options,
            headers
        });

        let result = {};

        try {
            result = await response.json();
        } catch (error) {
            throw new Error("Server returned an invalid response.");
        }

        if (!response.ok) {
            console.log("DASHBOARD_API_ERROR:", result);
            throw new Error(result.error || result.message || "Request failed.");
        }

        return result;
    }

    function money(value) {
        const number = Number(value || 0);
        return `Rs. ${number.toLocaleString()}`;
    }

    function normalizeCnic(value) {
        return String(value || "").replace(/\D/g, "").slice(0, 13);
    }

    function normalizePhone(value) {
        return String(value || "").replace(/\D/g, "").slice(0, 11);
    }

    function slugify(value) {
        return String(value || "")
            .toLowerCase()
            .trim()
            .replace(/[^a-z0-9]+/g, "_")
            .replace(/^_+|_+$/g, "");
    }

    function todayIsoDate() {
        const now = new Date();
        const year = now.getFullYear();
        const month = String(now.getMonth() + 1).padStart(2, "0");
        const day = String(now.getDate()).padStart(2, "0");

        return `${year}-${month}-${day}`;
    }

    function formatDateTime(value) {
        if (!value) {
            return "N/A";
        }

        const date = new Date(value);

        return date.toLocaleString([], {
            year: "numeric",
            month: "short",
            day: "2-digit",
            hour: "2-digit",
            minute: "2-digit"
        });
    }

    function dayName(dayNumber) {
        const days = {
            0: "Sunday",
            1: "Monday",
            2: "Tuesday",
            3: "Wednesday",
            4: "Thursday",
            5: "Friday",
            6: "Saturday"
        };

        return days[Number(dayNumber)] || String(dayNumber);
    }

    function setupRoleTabs(root, tabSelector, panelSelector, tabAttribute) {
        root.querySelectorAll(tabSelector).forEach((tab) => {
            tab.addEventListener("click", () => {
                const targetId = tab.getAttribute(tabAttribute);

                root.querySelectorAll(tabSelector).forEach((item) => {
                    item.classList.remove("active");
                });

                root.querySelectorAll(panelSelector).forEach((panel) => {
                    panel.classList.add("hidden");
                });

                tab.classList.add("active");

                const targetPanel = document.getElementById(targetId);

                if (targetPanel) {
                    targetPanel.classList.remove("hidden");
                }
            });
        });
    }

    async function verifySession() {
    const token = getToken();

    if (!token) {
        redirectToLogin();
        return;
    }

    const storedUser = getStoredUser();

    if (!storedUser || !storedUser.role) {
        redirectToLogin();
        return;
    }

    if (storedUser.role === "patient") {
        currentUser = storedUser;

        try {
            const result = await apiRequest("/api/patient/me");

            currentUser =
                result.user ||
                result.data?.user ||
                storedUser;
        } catch (error) {
            console.log("PATIENT_SESSION_CHECK_WARNING:", error.message);
            currentUser = storedUser;
        }

        saveSession(null, currentUser);
        setDashboardHeader(currentUser);
        showDashboardForRole(currentUser);
        return;
    }

    try {
        const result = await apiRequest("/api/auth/me");

        currentUser =
            result.user ||
            result.data ||
            storedUser;

        if (!currentUser || !currentUser.role) {
            currentUser = storedUser;
        }

        if (!currentUser || !currentUser.role) {
            redirectToLogin();
            return;
        }

        saveSession(null, currentUser);
        setDashboardHeader(currentUser);
        showDashboardForRole(currentUser);
    } catch (error) {
        console.log("SESSION_VERIFY_ERROR:", error.message);
        redirectToLogin();
    }
}
    

function showDashboardForRole(user) {
    hideAllDashboards();

    if (!user || !user.role) {
        redirectToLogin();
        return;
    }

    if (user.role === "admin") {
        if (adminDashboard) {
            adminDashboard.classList.remove("hidden");
        }
        return;
    }

    if (user.role === "doctor") {
        if (doctorDashboard) {
            doctorDashboard.classList.remove("hidden");
        }
        return;
    }

    if (user.role === "pa") {
        if (paDashboard) {
            paDashboard.classList.remove("hidden");
        }
        return;
    }

    if (user.role === "patient") {
        if (patientDashboard) {
            patientDashboard.classList.remove("hidden");
        }
        return;
    }

    redirectToLogin();
}
    function buildAdminDashboard() {
        adminDashboard.innerHTML = `
            <div class="dashboard-header">
                <div>
                    <h2>Admin Control</h2>
                    <p>Approve doctor requests and review platform activity.</p>
                </div>

                <button id="refreshAdminDashboardButton" type="button" class="secondary-button">
                    Refresh
                </button>
            </div>

            <div id="adminMessage" class="form-result"></div>

            <div id="adminSummaryCards" class="finance-summary-grid"></div>

            <div class="doctor-module-tabs">
                <button class="admin-module-tab active" type="button" data-admin-tab="adminPendingDoctorsTab">
                    Pending Doctors
                </button>

                <button class="admin-module-tab" type="button" data-admin-tab="adminAllDoctorsTab">
                    All Doctors
                </button>
            </div>

            <section id="adminPendingDoctorsTab" class="admin-module-panel">
                <div class="settings-list-card">
                    <h3>Pending Doctor Requests</h3>
                    <div id="pendingDoctorsList" class="compact-list scroll-list tall-scroll-list">
                        <p class="muted-text">Loading pending doctors...</p>
                    </div>
                </div>
            </section>

            <section id="adminAllDoctorsTab" class="admin-module-panel hidden">
                <div class="settings-list-card">
                    <h3>All Doctors</h3>
                    <div id="allDoctorsList" class="compact-list scroll-list tall-scroll-list">
                        <p class="muted-text">Loading doctors...</p>
                    </div>
                </div>
            </section>
        `;

        setupRoleTabs(adminDashboard, ".admin-module-tab", ".admin-module-panel", "data-admin-tab");

        const refreshButton = document.getElementById("refreshAdminDashboardButton");

        if (refreshButton) {
            refreshButton.addEventListener("click", loadAdminDashboard);
        }

        const pendingDoctorsList = document.getElementById("pendingDoctorsList");

        if (pendingDoctorsList) {
            pendingDoctorsList.addEventListener("click", handleAdminDoctorAction);
        }

        loadAdminDashboard();
    }

    function adminMsg(message, type) {
        const box = document.getElementById("adminMessage");

        if (!box) {
            return;
        }

        box.textContent = message || "";
        box.classList.remove("ok", "error", "pending");

        if (type) {
            box.classList.add(type);
        }
    }

    async function loadAdminDashboard() {
        try {
            adminMsg("Loading admin dashboard...", "pending");

            await Promise.all([
                loadAdminSummary(),
                loadPendingDoctors(),
                loadAllDoctors()
            ]);

            adminMsg("Admin dashboard loaded.", "ok");
        } catch (error) {
            adminMsg(error.message, "error");
        }
    }

    async function loadAdminSummary() {
        const summaryCards = document.getElementById("adminSummaryCards");

        if (!summaryCards) {
            return;
        }

        try {
            const result = await apiRequest("/api/admin/dashboard-summary");
            const data = result.data || result.summary || {};

            const cards = [
                {
                    label: "Pending Doctors",
                    value: data.pending_doctors || data.pendingDoctors || 0
                },
                {
                    label: "Approved Doctors",
                    value: data.approved_doctors || data.approvedDoctors || 0
                },
                {
                    label: "Total Doctors",
                    value: data.total_doctors || data.totalDoctors || 0
                },
                {
                    label: "Total Users",
                    value: data.total_users || data.totalUsers || 0
                }
            ];

            summaryCards.innerHTML = cards.map((card) => {
                return `
                    <div class="finance-card">
                        <span>${card.label}</span>
                        <strong>${card.value}</strong>
                    </div>
                `;
            }).join("");
        } catch (error) {
            summaryCards.innerHTML = `
                <div class="finance-card">
                    <span>Summary</span>
                    <strong>N/A</strong>
                </div>
            `;
        }
    }

    async function loadPendingDoctors() {
        const list = document.getElementById("pendingDoctorsList");

        if (!list) {
            return;
        }

        const result = await apiRequest("/api/admin/doctors/pending");
        const doctors = result.data || result.doctors || [];

        if (!doctors.length) {
            list.innerHTML = `<p class="muted-text">No pending doctor requests.</p>`;
            return;
        }

        list.innerHTML = doctors.map((doctor) => {
            return `
                <div class="compact-item" data-doctor-id="${doctor.doctor_id}">
                    <strong>${doctor.name || doctor.full_name || "Unnamed Doctor"}</strong>
                    <span>Email: ${doctor.email || doctor.login_email || "N/A"}</span>
                    <span>CNIC: ${doctor.cnic || "N/A"}</span>
                    <span>Phone: ${doctor.phone || "N/A"}</span>
                    <span>Specialization: ${doctor.specialization || "N/A"}</span>
                    <span>License: ${doctor.license_number || "N/A"}</span>
                    <span>Status: ${doctor.approval_status || "pending"}</span>

                    <div class="queue-card-actions">
                        <button type="button" data-action="approve-doctor">
                            Approve
                        </button>

                        <button type="button" class="danger-button" data-action="reject-doctor">
                            Reject
                        </button>
                    </div>
                </div>
            `;
        }).join("");
    }

    async function loadAllDoctors() {
        const list = document.getElementById("allDoctorsList");

        if (!list) {
            return;
        }

        const result = await apiRequest("/api/admin/doctors");
        const doctors = result.data || result.doctors || [];

        if (!doctors.length) {
            list.innerHTML = `<p class="muted-text">No doctors found.</p>`;
            return;
        }

        list.innerHTML = doctors.map((doctor) => {
            return `
                <div class="compact-item">
                    <strong>${doctor.name || doctor.full_name || "Unnamed Doctor"}</strong>
                    <span>Email: ${doctor.email || doctor.login_email || "N/A"}</span>
                    <span>CNIC: ${doctor.cnic || "N/A"}</span>
                    <span>Specialization: ${doctor.specialization || "N/A"}</span>
                    <span>License: ${doctor.license_number || "N/A"}</span>
                    <span>Status: ${doctor.approval_status || "N/A"}</span>
                    <span>Settings Completed: ${doctor.settings_completed ? "Yes" : "No"}</span>
                </div>
            `;
        }).join("");
    }

    async function handleAdminDoctorAction(event) {
        const button = event.target.closest("button[data-action]");

        if (!button) {
            return;
        }

        const card = event.target.closest("[data-doctor-id]");

        if (!card) {
            return;
        }

        const doctorId = card.getAttribute("data-doctor-id");
        const action = button.getAttribute("data-action");

        try {
            if (action === "approve-doctor") {
                adminMsg("Approving doctor...", "pending");

                await apiRequest(`/api/admin/doctors/${doctorId}/approve`, {
                    method: "POST"
                });

                adminMsg("Doctor approved.", "ok");
            }

            if (action === "reject-doctor") {
                const reason = window.prompt("Reason for rejection", "Incomplete or invalid information");

                if (reason === null) {
                    return;
                }

                adminMsg("Rejecting doctor...", "pending");

                await apiRequest(`/api/admin/doctors/${doctorId}/reject`, {
                    method: "POST",
                    headers: {
                        "Content-Type": "application/json"
                    },
                    body: JSON.stringify({
                        rejection_reason: reason
                    })
                });

                adminMsg("Doctor rejected.", "ok");
            }

            await loadAdminDashboard();
        } catch (error) {
            adminMsg(error.message, "error");
        }
    }

    function buildDoctorDashboard() {
        doctorDashboard.innerHTML = `
            <div class="dashboard-header">
                <div>
                    <h2>Doctor Workspace</h2>
                    <p>Manage your hospitals, schedules, assistants, fields, appointments, consultations, and finance.</p>
                </div>

                <button id="refreshDoctorDashboardButton" type="button" class="secondary-button">
                    Refresh
                </button>
            </div>

            <div id="doctorDashboardMessage" class="form-result"></div>

            <div class="doctor-module-tabs">
                <button class="doctor-module-tab active" type="button" data-doctor-tab="doctorSettingsTab">
                    Settings
                </button>

                <button class="doctor-module-tab" type="button" data-doctor-tab="doctorPaTab">
                    PA List
                </button>
            </div>

            <section id="doctorSettingsTab" class="doctor-module-panel">
                <div class="doctor-settings-grid">
                    <div class="settings-card">
                        <h3>Add Hospital / Clinic</h3>

                        <form id="doctorHospitalForm">
                            <label>Hospital / Clinic Name</label>
                            <input id="doctorHospitalName" type="text" placeholder="Hospital or clinic name" required>

                            <label>City</label>
                            <input id="doctorHospitalCity" type="text" placeholder="City">

                            <label>Address</label>
                            <textarea id="doctorHospitalAddress" placeholder="Complete address"></textarea>

                            <button type="submit">Add Hospital</button>
                        </form>
                    </div>

                    <div class="settings-card">
                        <h3>Add Schedule</h3>

                        <form id="doctorScheduleForm">
                            <label>Hospital / Clinic</label>
                            <select id="doctorScheduleHospital" required>
                                <option value="">Select hospital</option>
                            </select>

                            <label>Days</label>
                            <div id="doctorScheduleDays" class="checkbox-grid">
                                <label><input type="checkbox" value="0"> Sunday</label>
                                <label><input type="checkbox" value="1"> Monday</label>
                                <label><input type="checkbox" value="2"> Tuesday</label>
                                <label><input type="checkbox" value="3"> Wednesday</label>
                                <label><input type="checkbox" value="4"> Thursday</label>
                                <label><input type="checkbox" value="5"> Friday</label>
                                <label><input type="checkbox" value="6"> Saturday</label>
                            </div>

                            <label>Start Time</label>
                            <input id="doctorScheduleStart" type="time" required>

                            <label>End Time</label>
                            <input id="doctorScheduleEnd" type="time" required>

                            <label>Default Consultation Minutes</label>
                            <input id="doctorScheduleDuration" type="number" value="15" min="1" required>

                            <label>Consultation Fee</label>
                            <input id="doctorScheduleFee" type="number" value="0" min="0" required>

                            <button type="submit">Add Schedule</button>
                        </form>
                    </div>

                    <div class="settings-card">
                        <h3>Add Dynamic Consultation Field</h3>

                        <form id="doctorFieldForm">
                            <label>Field Label</label>
                            <input id="doctorFieldLabel" type="text" placeholder="Example: Pregnancy Month" required>

                            <label>Field Type</label>
                            <select id="doctorFieldType">
                                <option value="text">Text</option>
                                <option value="number">Number</option>
                                <option value="date">Date</option>
                                <option value="textarea">Long Text</option>
                            </select>

                            <label>Context</label>
                            <select id="doctorFieldContext">
                                <option value="consultation">Consultation</option>
                                <option value="patient">Patient</option>
                            </select>

                            <label>Required?</label>
                            <select id="doctorFieldRequired">
                                <option value="false">No</option>
                                <option value="true">Yes</option>
                            </select>

                            <button type="submit">Add Field</button>
                        </form>
                    </div>
                </div>

                <div class="doctor-settings-grid">
                    <div class="settings-list-card">
                        <h3>Hospitals / Clinics</h3>
                        <div id="doctorHospitalsList" class="compact-list scroll-list">
                            <p class="muted-text">No hospitals loaded.</p>
                        </div>
                    </div>

                    <div class="settings-list-card">
                        <h3>Schedules</h3>
                        <div id="doctorSchedulesList" class="compact-list scroll-list tall-scroll-list">
                            <p class="muted-text">No schedules loaded.</p>
                        </div>
                    </div>

                    <div class="settings-list-card">
                        <h3>Dynamic Fields</h3>
                        <div id="doctorFieldsList" class="compact-list scroll-list">
                            <p class="muted-text">No fields loaded.</p>
                        </div>
                    </div>
                </div>
            </section>

            <section id="doctorPaTab" class="doctor-module-panel hidden">
                <div class="doctor-settings-grid">
                    <div class="settings-card">
                        <h3>Invite / Link PA</h3>

                        <form id="doctorPaInviteForm">
                            <label>PA CNIC</label>
                            <input id="doctorPaCnic" type="text" placeholder="13 digit CNIC" maxlength="13" inputmode="numeric" required>

                            <label>PA Email</label>
                            <input id="doctorPaEmail" type="email" placeholder="pa@example.com" required>

                            <label>Hospital / Clinic</label>
                            <select id="doctorPaHospital" required>
                                <option value="">Select hospital</option>
                            </select>

                            <button type="submit">Invite / Link PA</button>
                        </form>
                    </div>

                    <div class="settings-list-card">
                        <h3>Linked PAs</h3>
                        <div id="doctorPaLinksList" class="compact-list scroll-list tall-scroll-list">
                            <p class="muted-text">No PA links loaded.</p>
                        </div>
                    </div>

                    <div class="settings-list-card">
                        <h3>PA Invites</h3>
                        <div id="doctorPaInvitesList" class="compact-list scroll-list tall-scroll-list">
                            <p class="muted-text">No PA invites loaded.</p>
                        </div>
                    </div>
                </div>
            </section>
        `;

        setupRoleTabs(doctorDashboard, ".doctor-module-tab", ".doctor-module-panel", "data-doctor-tab");

        document.getElementById("refreshDoctorDashboardButton").addEventListener("click", loadDoctorDashboard);
        document.getElementById("doctorHospitalForm").addEventListener("submit", addDoctorHospital);
        document.getElementById("doctorScheduleForm").addEventListener("submit", addDoctorSchedule);
        document.getElementById("doctorFieldForm").addEventListener("submit", addDoctorField);
        document.getElementById("doctorPaInviteForm").addEventListener("submit", inviteOrLinkPa);

        const schedulesList = document.getElementById("doctorSchedulesList");

        if (schedulesList) {
            schedulesList.addEventListener("click", handleScheduleAction);
        }

        loadDoctorDashboard();
    }

    function doctorMsg(message, type) {
        const box = document.getElementById("doctorDashboardMessage");

        if (!box) {
            return;
        }

        box.textContent = message || "";
        box.classList.remove("ok", "error", "pending");

        if (type) {
            box.classList.add(type);
        }
    }

    async function loadDoctorDashboard() {
        try {
            doctorMsg("Loading doctor workspace...", "pending");

            await Promise.all([
                loadDoctorSettings(),
                loadDoctorPaData()
            ]);

            doctorMsg("Doctor workspace loaded.", "ok");
        } catch (error) {
            doctorMsg(error.message, "error");
        }
    }

    async function loadDoctorSettings() {
        const result = await apiRequest("/api/doctor/settings");
        const data = result.data || result;

        doctorSettingsCache.hospitals =
            data.hospitals ||
            data.doctor_hospitals ||
            data.doctorHospitals ||
            [];

        doctorSettingsCache.schedules =
            data.schedules ||
            data.hospital_schedules ||
            data.doctor_hospital_schedules ||
            [];

        doctorSettingsCache.formFields =
            data.form_fields ||
            data.formFields ||
            data.dynamic_fields ||
            [];

        renderDoctorHospitals();
        renderDoctorScheduleHospitalOptions();
        renderDoctorSchedules();
        renderDoctorFields();
    }

    function renderDoctorHospitals() {
        const list = document.getElementById("doctorHospitalsList");

        if (!list) {
            return;
        }

        const hospitals = doctorSettingsCache.hospitals || [];

        if (!hospitals.length) {
            list.innerHTML = `<p class="muted-text">No hospitals added yet.</p>`;
            return;
        }

        list.innerHTML = hospitals.map((hospital) => {
            return `
                <div class="compact-item">
                    <strong>${hospital.name || hospital.hospital_name || "Unnamed Hospital"}</strong>
                    <span>City: ${hospital.city || "N/A"}</span>
                    <span>Address: ${hospital.address || "N/A"}</span>
                    <span>Status: ${hospital.is_active === false ? "Inactive" : "Active"}</span>
                </div>
            `;
        }).join("");
    }

    function renderDoctorScheduleHospitalOptions() {
        const scheduleSelect = document.getElementById("doctorScheduleHospital");
        const paHospitalSelect = document.getElementById("doctorPaHospital");
        const hospitals = doctorSettingsCache.hospitals || [];

        const options = `<option value="">Select hospital</option>` + hospitals.map((hospital) => {
            return `
                <option value="${hospital.id || hospital.doctor_hospital_id}">
                    ${hospital.name || hospital.hospital_name} - ${hospital.city || ""}
                </option>
            `;
        }).join("");

        if (scheduleSelect) {
            scheduleSelect.innerHTML = options;
        }

        if (paHospitalSelect) {
            paHospitalSelect.innerHTML = options;
        }
    }

    function renderDoctorSchedules() {
        const list = document.getElementById("doctorSchedulesList");

        if (!list) {
            return;
        }

        const schedules = doctorSettingsCache.schedules || [];

        if (!schedules.length) {
            list.innerHTML = `<p class="muted-text">No schedules added yet.</p>`;
            return;
        }

        list.innerHTML = schedules.map((schedule) => {
            const hospital =
                doctorSettingsCache.hospitals.find((item) => {
                    return String(item.id || item.doctor_hospital_id) === String(schedule.doctor_hospital_id);
                }) || {};

            return `
                <div class="compact-item" data-schedule-id="${schedule.schedule_id}">
                    <strong>${hospital.name || schedule.hospital_name || "Hospital"}</strong>
                    <span>Day: ${dayName(schedule.day_of_week)}</span>
                    <span>Time: ${String(schedule.start_time || "").slice(0, 5)} - ${String(schedule.end_time || "").slice(0, 5)}</span>
                    <span>Duration: ${schedule.default_consultation_minutes || schedule.duration_minutes || 15} minutes</span>
                    <span>Fee: ${money(schedule.consultation_fee || schedule.fee || 0)}</span>

                    <div class="queue-card-actions">
                        <button type="button" class="danger-button" data-action="delete-schedule">
                            Delete
                        </button>
                    </div>
                </div>
            `;
        }).join("");
    }

    function renderDoctorFields() {
        const list = document.getElementById("doctorFieldsList");

        if (!list) {
            return;
        }

        const fields = doctorSettingsCache.formFields || [];

        if (!fields.length) {
            list.innerHTML = `<p class="muted-text">No dynamic fields added yet.</p>`;
            return;
        }

        list.innerHTML = fields.map((field) => {
            return `
                <div class="compact-item">
                    <strong>${field.field_label || field.label || "Field"}</strong>
                    <span>Key: ${field.field_key || "N/A"}</span>
                    <span>Type: ${field.field_type || "text"}</span>
                    <span>Context: ${field.field_context || "consultation"}</span>
                    <span>Required: ${field.is_required ? "Yes" : "No"}</span>
                </div>
            `;
        }).join("");
    }

    async function addDoctorHospital(event) {
        event.preventDefault();

        const name = document.getElementById("doctorHospitalName").value.trim();
        const city = document.getElementById("doctorHospitalCity").value.trim();
        const address = document.getElementById("doctorHospitalAddress").value.trim();

        if (!name) {
            doctorMsg("Hospital name is required.", "error");
            return;
        }

        try {
            doctorMsg("Adding hospital...", "pending");

            await apiRequest("/api/doctor/hospitals", {
                method: "POST",
                headers: {
                    "Content-Type": "application/json"
                },
                body: JSON.stringify({
                    name,
                    city,
                    address
                })
            });

            document.getElementById("doctorHospitalForm").reset();

            await loadDoctorSettings();

            doctorMsg("Hospital added successfully.", "ok");
        } catch (error) {
            doctorMsg(error.message, "error");
        }
    }

    function getSelectedScheduleDays() {
        return Array.from(document.querySelectorAll("#doctorScheduleDays input[type='checkbox']:checked"))
            .map((checkbox) => Number(checkbox.value));
    }

    function scheduleAlreadyExists(hospitalId, dayNumber, startTime, endTime) {
        return doctorSettingsCache.schedules.some((schedule) => {
            return (
                String(schedule.doctor_hospital_id) === String(hospitalId) &&
                Number(schedule.day_of_week) === Number(dayNumber) &&
                String(schedule.start_time || "").slice(0, 5) === String(startTime || "").slice(0, 5) &&
                String(schedule.end_time || "").slice(0, 5) === String(endTime || "").slice(0, 5)
            );
        });
    }

    async function addDoctorSchedule(event) {
        event.preventDefault();

        const hospitalId = document.getElementById("doctorScheduleHospital").value;
        const selectedDays = getSelectedScheduleDays();
        const startTime = document.getElementById("doctorScheduleStart").value;
        const endTime = document.getElementById("doctorScheduleEnd").value;
        const duration = Number(document.getElementById("doctorScheduleDuration").value || 15);
        const fee = Number(document.getElementById("doctorScheduleFee").value || 0);

        if (!hospitalId) {
            doctorMsg("Select hospital first.", "error");
            return;
        }

        if (!selectedDays.length) {
            doctorMsg("Select at least one day.", "error");
            return;
        }

        if (!startTime || !endTime) {
            doctorMsg("Start and end time are required.", "error");
            return;
        }

        if (startTime >= endTime) {
            doctorMsg("Start time must be before end time.", "error");
            return;
        }

        try {
            doctorMsg("Adding schedule...", "pending");

            for (const day of selectedDays) {
                if (scheduleAlreadyExists(hospitalId, day, startTime, endTime)) {
                    throw new Error(`Duplicate schedule found for ${dayName(day)} at same time.`);
                }

                await apiRequest(`/api/doctor/hospitals/${hospitalId}/schedules`, {
                    method: "POST",
                    headers: {
                        "Content-Type": "application/json"
                    },
                    body: JSON.stringify({
                        day_of_week: day,
                        start_time: startTime,
                        end_time: endTime,
                        default_consultation_minutes: duration,
                        consultation_fee: fee
                    })
                });
            }

            document.getElementById("doctorScheduleForm").reset();

            await loadDoctorSettings();

            doctorMsg("Schedule added successfully.", "ok");
        } catch (error) {
            doctorMsg(error.message, "error");
        }
    }

    async function handleScheduleAction(event) {
        const button = event.target.closest("button[data-action]");

        if (!button) {
            return;
        }

        const card = event.target.closest("[data-schedule-id]");

        if (!card) {
            return;
        }

        const scheduleId = card.getAttribute("data-schedule-id");

        if (button.getAttribute("data-action") === "delete-schedule") {
            const confirmed = window.confirm("Delete this schedule?");

            if (!confirmed) {
                return;
            }

            try {
                doctorMsg("Deleting schedule...", "pending");

                await apiRequest(`/api/doctor/schedules/${scheduleId}`, {
                    method: "DELETE"
                });

                await loadDoctorSettings();

                doctorMsg("Schedule deleted.", "ok");
            } catch (error) {
                doctorMsg(error.message, "error");
            }
        }
    }

    async function addDoctorField(event) {
        event.preventDefault();

        const label = document.getElementById("doctorFieldLabel").value.trim();
        const type = document.getElementById("doctorFieldType").value;
        const context = document.getElementById("doctorFieldContext").value;
        const required = document.getElementById("doctorFieldRequired").value === "true";

        if (!label) {
            doctorMsg("Field label is required.", "error");
            return;
        }

        try {
            doctorMsg("Adding dynamic field...", "pending");

            await apiRequest("/api/doctor/form-fields", {
                method: "POST",
                headers: {
                    "Content-Type": "application/json"
                },
                body: JSON.stringify({
                    field_label: label,
                    field_key: slugify(label),
                    field_type: type,
                    field_context: context,
                    is_required: required,
                    display_order: (doctorSettingsCache.formFields || []).length + 1
                })
            });

            document.getElementById("doctorFieldForm").reset();

            await loadDoctorSettings();

            doctorMsg("Dynamic field added successfully.", "ok");
        } catch (error) {
            doctorMsg(error.message, "error");
        }
    }

    async function loadDoctorPaData() {
        try {
            const linksResult = await apiRequest("/api/doctor/pa-links");
            doctorSettingsCache.paLinks = linksResult.data || linksResult.links || [];
        } catch (error) {
            doctorSettingsCache.paLinks = [];
        }

        try {
            const invitesResult = await apiRequest("/api/doctor/pa-invites");
            doctorSettingsCache.paInvites = invitesResult.data || invitesResult.invites || [];
        } catch (error) {
            doctorSettingsCache.paInvites = [];
        }

        renderDoctorPaLinks();
        renderDoctorPaInvites();
    }

    function renderDoctorPaLinks() {
        const list = document.getElementById("doctorPaLinksList");

        if (!list) {
            return;
        }

        const links = doctorSettingsCache.paLinks || [];

        if (!links.length) {
            list.innerHTML = `<p class="muted-text">No linked PAs found.</p>`;
            return;
        }

        list.innerHTML = links.map((link) => {
            return `
                <div class="compact-item">
                    <strong>${link.full_name || link.pa_name || "Unnamed PA"}</strong>
                    <span>CNIC: ${link.cnic || "N/A"}</span>
                    <span>Email: ${link.email || "N/A"}</span>
                    <span>Hospital: ${link.hospital_name || "N/A"}</span>
                    <span>Status: ${link.is_active === false ? "Inactive" : "Active"}</span>
                </div>
            `;
        }).join("");
    }

    function renderDoctorPaInvites() {
        const list = document.getElementById("doctorPaInvitesList");

        if (!list) {
            return;
        }

        const invites = doctorSettingsCache.paInvites || [];

        if (!invites.length) {
            list.innerHTML = `<p class="muted-text">No PA invites found.</p>`;
            return;
        }

        list.innerHTML = invites.map((invite) => {
            const token = invite.invite_token;
            const link = token ? `${window.location.origin}${window.location.pathname.replace("dashboard.html", "")}pa-register.html?token=${token}` : "";

            return `
                <div class="compact-item">
                    <strong>${invite.email || invite.pa_email || "PA Invite"}</strong>
                    <span>CNIC: ${invite.invited_cnic || invite.cnic || "N/A"}</span>
                    <span>Status: ${invite.status || "pending"}</span>
                    ${link ? `<span>Link: ${link}</span>` : ""}
                </div>
            `;
        }).join("");
    }

    async function inviteOrLinkPa(event) {
        event.preventDefault();

        const cnic = normalizeCnic(document.getElementById("doctorPaCnic").value);
        const email = document.getElementById("doctorPaEmail").value.trim().toLowerCase();
        const hospitalId = document.getElementById("doctorPaHospital").value;

        if (!/^[0-9]{13}$/.test(cnic)) {
            doctorMsg("PA CNIC must be exactly 13 digits.", "error");
            return;
        }

        if (!email) {
            doctorMsg("PA email is required.", "error");
            return;
        }

        if (!hospitalId) {
            doctorMsg("Select hospital for PA.", "error");
            return;
        }

        try {
            doctorMsg("Creating PA invite/link...", "pending");

            await apiRequest("/api/doctor/pa-invites", {
                method: "POST",
                headers: {
                    "Content-Type": "application/json"
                },
                body: JSON.stringify({
                    cnic,
                    invited_cnic: cnic,
                    email,
                    pa_email: email,
                    doctor_hospital_id: Number(hospitalId)
                })
            });

            document.getElementById("doctorPaInviteForm").reset();

            await loadDoctorPaData();

            doctorMsg("PA invite/link created.", "ok");
        } catch (error) {
            doctorMsg(error.message, "error");
        }
    }

    function buildPaDashboard() {
        paDashboard.innerHTML = `
            <div class="dashboard-header">
                <div>
                    <h2>PA Workspace</h2>
                    <p>Manage doctor assignments, book appointments, view daily appointments, update payments, and print prescriptions.</p>
                </div>

                <button id="refreshPaDashboardButton" type="button" class="secondary-button">
                    Refresh
                </button>
            </div>

            <div id="paDashboardMessage" class="form-result"></div>

            <div class="doctor-module-tabs">
                <button class="pa-module-tab active" type="button" data-pa-tab="paAssignmentsTab">
                    Assigned Doctors
                </button>

                <button class="pa-module-tab" type="button" data-pa-tab="paBookAppointmentTab">
                    Book Appointment
                </button>

                <button class="pa-module-tab" type="button" data-pa-tab="paAppointmentsTab">
                    Appointments
                </button>
            </div>

            <section id="paAssignmentsTab" class="pa-module-panel">
                <div class="settings-list-card">
                    <h3>Assigned Doctors / Hospitals</h3>
                    <div id="paAssignmentsList" class="compact-list scroll-list tall-scroll-list">
                        <p class="muted-text">Loading assignments...</p>
                    </div>
                </div>
            </section>

            <section id="paBookAppointmentTab" class="pa-module-panel hidden">
                <div class="patient-request-grid">
                    <div class="settings-card">
                        <h3>Patient Information</h3>

                        <form id="paAppointmentForm">
                            <label>Doctor Assignment</label>
                            <select id="paAppointmentAssignment" required>
                                <option value="">Select assignment</option>
                            </select>

                            <label>Patient CNIC</label>
                            <input id="paPatientCnic" type="text" placeholder="13 digit CNIC" maxlength="13" inputmode="numeric" required>

                            <label>Patient Name</label>
                            <input id="paPatientName" type="text" placeholder="Patient full name" required>

                            <label>Gender</label>
                            <select id="paPatientGender">
                                <option value="">Select gender</option>
                                <option value="male">Male</option>
                                <option value="female">Female</option>
                                <option value="other">Other</option>
                            </select>

                            <label>Date of Birth</label>
                            <input id="paPatientDob" type="date">

                            <label>Phone</label>
                            <input id="paPatientPhone" type="text" placeholder="03001234567" maxlength="11" inputmode="numeric">

                            <label>Email</label>
                            <input id="paPatientEmail" type="email" placeholder="patient@example.com">

                            <label>Fee Charged</label>
                            <input id="paAppointmentFee" type="number" min="0" value="0">

                            <label>Fee Status</label>
                            <select id="paAppointmentFeeStatus">
                                <option value="paid">Paid</option>
                                <option value="pending">Pending</option>
                                <option value="waived">Waived</option>
                            </select>

                            <label>Duration Minutes</label>
                            <input id="paAppointmentDuration" type="number" min="1" value="15">

                            <label>Notes</label>
                            <textarea id="paAppointmentNotes" placeholder="Optional notes"></textarea>
                        </form>
                    </div>

                    <div class="settings-list-card">
                        <h3>Available Slots</h3>

                        <button id="loadPaSlotsButton" type="button">
                            Load Slots
                        </button>

                        <div id="paSlotsList" class="compact-list scroll-list tall-scroll-list">
                            <p class="muted-text">Select assignment and load slots.</p>
                        </div>
                    </div>

                    <div class="settings-card">
                        <h3>Selected Slot</h3>

                        <div id="paSelectedSlotBox">
                            <p class="muted-text">No slot selected.</p>
                        </div>

                        <button id="bookPaAppointmentButton" type="button">
                            Book Appointment
                        </button>
                    </div>
                </div>
            </section>

            <section id="paAppointmentsTab" class="pa-module-panel hidden">
                <div class="queue-filter-grid">
                    <div>
                        <label>Date</label>
                        <input id="paAppointmentsDate" type="date">
                    </div>
                </div>

                <div class="settings-list-card">
                    <h3>Appointments</h3>
                    <div id="paAppointmentsList" class="compact-list scroll-list tall-scroll-list">
                        <p class="muted-text">No appointments loaded.</p>
                    </div>
                </div>
            </section>
        `;

        setupRoleTabs(paDashboard, ".pa-module-tab", ".pa-module-panel", "data-pa-tab");

        document.getElementById("refreshPaDashboardButton").addEventListener("click", loadPaDashboard);
        document.getElementById("loadPaSlotsButton").addEventListener("click", loadPaSlots);
        document.getElementById("bookPaAppointmentButton").addEventListener("click", bookPaAppointment);

        const assignmentSelect = document.getElementById("paAppointmentAssignment");

        if (assignmentSelect) {
            assignmentSelect.addEventListener("change", handlePaAssignmentChange);
        }

        const paSlotsList = document.getElementById("paSlotsList");

        if (paSlotsList) {
            paSlotsList.addEventListener("click", handlePaSlotSelection);
        }

        const dateInput = document.getElementById("paAppointmentsDate");

        if (dateInput) {
            dateInput.value = todayIsoDate();
            dateInput.addEventListener("change", loadPaAppointments);
        }

        loadPaDashboard();
    }

    function paMsg(message, type) {
        const box = document.getElementById("paDashboardMessage");

        if (!box) {
            return;
        }

        box.textContent = message || "";
        box.classList.remove("ok", "error", "pending");

        if (type) {
            box.classList.add(type);
        }
    }

    async function loadPaDashboard() {
        try {
            paMsg("Loading PA workspace...", "pending");

            await loadPaAssignments();
            await loadPaAppointments();

            paMsg("PA workspace loaded.", "ok");
        } catch (error) {
            paMsg(error.message, "error");
        }
    }

    async function loadPaAssignments() {
        const result = await apiRequest("/api/pa/assignments");
        paWorkspaceCache.assignments = result.data || result.assignments || [];

        renderPaAssignments();
        renderPaAssignmentOptions();
    }

    function renderPaAssignments() {
        const list = document.getElementById("paAssignmentsList");

        if (!list) {
            return;
        }

        const assignments = paWorkspaceCache.assignments || [];

        if (!assignments.length) {
            list.innerHTML = `<p class="muted-text">No assigned doctors found.</p>`;
            return;
        }

        list.innerHTML = assignments.map((assignment) => {
            return `
                <div class="compact-item">
                    <strong>${assignment.doctor_name || "Doctor"}</strong>
                    <span>Specialization: ${assignment.specialization || "N/A"}</span>
                    <span>Hospital: ${assignment.hospital_name || "N/A"} - ${assignment.hospital_city || ""}</span>
                    <span>Fee: ${money(assignment.consultation_fee || assignment.default_fee || 0)}</span>
                    <span>Duration: ${assignment.default_consultation_minutes || 15} minutes</span>
                </div>
            `;
        }).join("");
    }

    function renderPaAssignmentOptions() {
        const select = document.getElementById("paAppointmentAssignment");

        if (!select) {
            return;
        }

        const assignments = paWorkspaceCache.assignments || [];

        select.innerHTML =
            `<option value="">Select assignment</option>` +
            assignments.map((assignment) => {
                return `
                    <option value="${assignment.assignment_id || assignment.doctor_pa_id || assignment.id}">
                        ${assignment.doctor_name || "Doctor"} - ${assignment.hospital_name || "Hospital"}
                    </option>
                `;
            }).join("");
    }

    function getSelectedAssignment() {
        const select = document.getElementById("paAppointmentAssignment");

        if (!select) {
            return null;
        }

        const selectedId = select.value;

        return (paWorkspaceCache.assignments || []).find((assignment) => {
            return String(assignment.assignment_id || assignment.doctor_pa_id || assignment.id) === String(selectedId);
        }) || null;
    }

    function handlePaAssignmentChange() {
        const assignment = getSelectedAssignment();

        if (!assignment) {
            return;
        }

        const feeInput = document.getElementById("paAppointmentFee");
        const durationInput = document.getElementById("paAppointmentDuration");

        if (feeInput) {
            feeInput.value = assignment.consultation_fee || assignment.default_fee || 0;
        }

        if (durationInput) {
            durationInput.value = assignment.default_consultation_minutes || 15;
        }

        paWorkspaceCache.selectedSlot = null;
        renderPaSelectedSlot();
    }

    async function loadPaSlots() {
        const assignment = getSelectedAssignment();

        if (!assignment) {
            paMsg("Select assignment first.", "error");
            return;
        }

        const assignmentId = assignment.assignment_id || assignment.doctor_pa_id || assignment.id;

        try {
            paMsg("Loading available slots...", "pending");

            const result = await apiRequest(`/api/pa/available-slots?assignment_id=${assignmentId}&days=14`);
            const slots = result.data || result.slots || [];

            renderPaSlots(slots);

            paMsg(`${slots.length} slot(s) loaded.`, "ok");
        } catch (error) {
            paMsg(error.message, "error");
        }
    }

    function renderPaSlots(slots) {
        const list = document.getElementById("paSlotsList");

        if (!list) {
            return;
        }

        paWorkspaceCache.selectedSlot = null;
        renderPaSelectedSlot();

        if (!slots.length) {
            list.innerHTML = `<p class="muted-text">No available slots found.</p>`;
            list.dataset.slots = "[]";
            return;
        }

        list.dataset.slots = JSON.stringify(slots);

        list.innerHTML = slots.map((slot, index) => {
            return `
                <button type="button" class="slot-button" data-slot-index="${index}">
                    <strong>${slot.date || String(slot.appointment_datetime || "").slice(0, 10)}</strong>
                    <span>${slot.start_time || formatDateTime(slot.appointment_datetime)} - ${slot.end_time || ""}</span>
                    <span>Fee: ${money(slot.expected_fee || slot.consultation_fee || 0)}</span>
                </button>
            `;
        }).join("");
    }

    function handlePaSlotSelection(event) {
        const button = event.target.closest(".slot-button");

        if (!button) {
            return;
        }

        const list = document.getElementById("paSlotsList");
        const slots = JSON.parse(list.dataset.slots || "[]");
        const index = Number(button.getAttribute("data-slot-index"));

        paWorkspaceCache.selectedSlot = slots[index];

        list.querySelectorAll(".slot-button").forEach((item) => {
            item.classList.remove("selected");
        });

        button.classList.add("selected");

        renderPaSelectedSlot();
    }

    function renderPaSelectedSlot() {
        const box = document.getElementById("paSelectedSlotBox");

        if (!box) {
            return;
        }

        const slot = paWorkspaceCache.selectedSlot;

        if (!slot) {
            box.innerHTML = `<p class="muted-text">No slot selected.</p>`;
            return;
        }

        box.innerHTML = `
            <div class="compact-item">
                <strong>${slot.date || String(slot.appointment_datetime || "").slice(0, 10)}</strong>
                <span>Time: ${slot.start_time || formatDateTime(slot.appointment_datetime)} - ${slot.end_time || ""}</span>
                <span>Fee: ${money(slot.expected_fee || slot.consultation_fee || 0)}</span>
            </div>
        `;
    }

    async function bookPaAppointment() {
        const assignment = getSelectedAssignment();
        const slot = paWorkspaceCache.selectedSlot;

        if (!assignment) {
            paMsg("Select assignment first.", "error");
            return;
        }

        if (!slot) {
            paMsg("Select available slot first.", "error");
            return;
        }

        const cnic = normalizeCnic(document.getElementById("paPatientCnic").value);
        const name = document.getElementById("paPatientName").value.trim();
        const gender = document.getElementById("paPatientGender").value;
        const dob = document.getElementById("paPatientDob").value;
        const phone = normalizePhone(document.getElementById("paPatientPhone").value);
        const email = document.getElementById("paPatientEmail").value.trim();
        const fee = Number(document.getElementById("paAppointmentFee").value || 0);
        const feeStatus = document.getElementById("paAppointmentFeeStatus").value;
        const duration = Number(document.getElementById("paAppointmentDuration").value || 15);
        const notes = document.getElementById("paAppointmentNotes").value.trim();

        if (!/^[0-9]{13}$/.test(cnic)) {
            paMsg("Patient CNIC must be exactly 13 digits.", "error");
            return;
        }

        if (!name) {
            paMsg("Patient name is required.", "error");
            return;
        }

        try {
            paMsg("Booking appointment...", "pending");

            const assignmentId = assignment.assignment_id || assignment.doctor_pa_id || assignment.id;

            const payload = {
                assignment_id: assignmentId,
                doctor_pa_id: assignmentId,
                patient_cnic: cnic,
                cnic: cnic,
                patient_name: name,
                name: name,
                gender: gender,
                dob: dob || null,
                phone: phone,
                email: email,
                appointment_datetime: slot.appointment_datetime,
                scheduled_start: slot.appointment_datetime,
                duration_minutes: duration,
                fee_charged: fee,
                fee_status: feeStatus,
                notes: notes,
                source: "walk_in"
            };

            await apiRequest("/api/pa/appointments", {
                method: "POST",
                headers: {
                    "Content-Type": "application/json"
                },
                body: JSON.stringify(payload)
            });

            document.getElementById("paAppointmentForm").reset();
            paWorkspaceCache.selectedSlot = null;
            renderPaSelectedSlot();

            await loadPaAppointments();

            paMsg("Appointment booked successfully.", "ok");
        } catch (error) {
            paMsg(error.message, "error");
        }
    }

    async function loadPaAppointments() {
        const list = document.getElementById("paAppointmentsList");
        const dateInput = document.getElementById("paAppointmentsDate");

        if (!list || !dateInput) {
            return;
        }

        const date = dateInput.value || todayIsoDate();

        try {
            const result = await apiRequest(`/api/pa/appointments?date=${date}`);
            const appointments = result.data || result.appointments || [];

            if (!appointments.length) {
                list.innerHTML = `<p class="muted-text">No appointments found for this date.</p>`;
                return;
            }

            list.innerHTML = appointments.map((appointment) => {
                return `
                    <div class="compact-item">
                        <strong>${appointment.patient_name || appointment.name || "Patient"}</strong>
                        <span>CNIC: ${appointment.patient_cnic || appointment.cnic || "N/A"}</span>
                        <span>Doctor: ${appointment.doctor_name || "N/A"}</span>
                        <span>Hospital: ${appointment.hospital_name || "N/A"} - ${appointment.hospital_city || ""}</span>
                        <span>Time: ${formatDateTime(appointment.appointment_datetime || appointment.scheduled_start)}</span>
                        <span>Fee: ${money(appointment.fee_charged)} (${appointment.fee_status})</span>
                        <span>Status: ${appointment.status}</span>
                        <span>Source: ${appointment.source || "walk_in"}</span>
                    </div>
                `;
            }).join("");
        } catch (error) {
            list.innerHTML = `<p class="muted-text">${error.message}</p>`;
        }
    }

    if (logoutButton) {
        logoutButton.addEventListener("click", () => {
            redirectToLogin();
        });
    }

    verifySession();
});