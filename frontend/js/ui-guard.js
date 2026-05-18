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

    let adminLoading = false;
    let paLoading = false;
    let paAppointmentsLoading = false;
    let firstLoadDone = false;

    const cooldowns = {};

    function canRun(key, ms = 900) {
        const now = Date.now();

        if (cooldowns[key] && now - cooldowns[key] < ms) {
            return false;
        }

        cooldowns[key] = now;
        return true;
    }

    function getToken() {
        return localStorage.getItem("hm_token");
    }

    function getUser() {
        try {
            return JSON.parse(localStorage.getItem("hm_user") || "null");
        } catch (error) {
            return null;
        }
    }

    function roleIs(role) {
        const user = getUser();
        return user && user.role === role;
    }

    function byId(...ids) {
        for (const id of ids) {
            const element = document.getElementById(id);

            if (element) {
                return element;
            }
        }

        return null;
    }

    function allByIds(...ids) {
        return ids
            .map((id) => document.getElementById(id))
            .filter(Boolean);
    }

    function todayIsoDate() {
        const now = new Date();
        const year = now.getFullYear();
        const month = String(now.getMonth() + 1).padStart(2, "0");
        const day = String(now.getDate()).padStart(2, "0");

        return `${year}-${month}-${day}`;
    }

    function money(value) {
        const number = Number(value || 0);
        return `Rs. ${number.toLocaleString()}`;
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

    function setMessage(element, message, type) {
        if (!element) {
            return;
        }

        element.textContent = message || "";
        element.classList.remove("ok", "error", "pending");

        if (type) {
            element.classList.add(type);
        }
    }

    function setAdminMessage(message, type) {
        setMessage(
            byId("adminMessage", "adminDashboardMessage", "dashboardMessage"),
            message,
            type
        );
    }

    function setPaMessage(message, type) {
        setMessage(
            byId("paWorkspaceMessage", "paDashboardMessage", "dashboardMessage"),
            message,
            type
        );
    }

    async function apiRequest(path, options = {}) {
        const token = getToken();

        if (!token) {
            window.location.href = "./index.html";
            throw new Error("Login session expired.");
        }

        const response = await fetch(`${API_BASE_URL}${path}`, {
            ...options,
            headers: {
                ...(options.headers || {}),
                "Authorization": `Bearer ${token}`
            }
        });

        let result = {};

        try {
            result = await response.json();
        } catch (error) {
            throw new Error("Server returned invalid JSON.");
        }

        if (!response.ok) {
            console.log("UI_GUARD_API_ERROR:", path, result);
            throw new Error(result.error || result.message || "Request failed.");
        }

        return result;
    }

    function extractArray(result, keys = []) {
        if (Array.isArray(result)) {
            return result;
        }

        if (Array.isArray(result.data)) {
            return result.data;
        }

        for (const key of keys) {
            if (Array.isArray(result[key])) {
                return result[key];
            }

            if (result.data && Array.isArray(result.data[key])) {
                return result.data[key];
            }
        }

        return [];
    }

    function activateTab(root, tab, tabSelector, panelSelector, attributeName) {
        if (!root || !tab) {
            return;
        }

        const targetId = tab.getAttribute(attributeName);

        if (!targetId) {
            return;
        }

        const targetPanel = document.getElementById(targetId);

        if (!targetPanel) {
            console.log("TAB_TARGET_PANEL_NOT_FOUND:", targetId);
            return;
        }

        root.querySelectorAll(tabSelector).forEach((item) => {
            item.classList.remove("active");
        });

        root.querySelectorAll(panelSelector).forEach((panel) => {
            panel.classList.add("hidden");
        });

        tab.classList.add("active");
        targetPanel.classList.remove("hidden");

        window.dispatchEvent(new CustomEvent("hm:tab-opened", {
            detail: {
                panelId: targetId
            }
        }));

        if (targetId === "adminPendingDoctorsTab" || targetId === "adminAllDoctorsTab") {
            loadAdminDashboard();
            return;
        }

        if (targetId === "paAssignmentsTab" || targetId === "paBookAppointmentTab") {
            loadPaWorkspace();
            return;
        }

        if (targetId === "paAppointmentsTab") {
            loadPaWorkspace();
            loadPaAppointments();
            return;
        }
    }

    function doctorId(doctor) {
        return doctor.doctor_id || doctor.id || doctor.request_id || doctor.signup_request_id;
    }

    function doctorName(doctor) {
        return (
            doctor.name ||
            doctor.full_name ||
            doctor.doctor_name ||
            doctor.email ||
            doctor.login_email ||
            "Unnamed Doctor"
        );
    }

    function doctorStatus(doctor) {
        return doctor.approval_status || doctor.status || doctor.doctor_status || "pending";
    }

    function normalizeDoctorList(list) {
        return list.map((doctor) => ({
            ...doctor,
            _doctor_id: doctorId(doctor),
            _name: doctorName(doctor),
            _status: doctorStatus(doctor)
        }));
    }

    function isPendingDoctor(doctor) {
        const status = String(doctor._status || "").toLowerCase();

        return (
            status === "pending" ||
            status === "requested" ||
            status === "submitted" ||
            status === "under_review" ||
            status.includes("pending")
        );
    }

    async function fetchAllDoctors() {
        const result = await apiRequest("/api/admin/doctors");

        return normalizeDoctorList(extractArray(result, [
            "doctors",
            "all_doctors",
            "allDoctors",
            "users"
        ]));
    }

    async function fetchPendingDoctors(allDoctors) {
        try {
            const result = await apiRequest("/api/admin/doctors/pending");

            const pendingDoctors = normalizeDoctorList(extractArray(result, [
                "doctors",
                "pending_doctors",
                "pendingDoctors",
                "requests",
                "signup_requests"
            ]));

            if (pendingDoctors.length) {
                return pendingDoctors;
            }
        } catch (error) {
            console.log("PENDING_DOCTORS_ENDPOINT_WARNING:", error.message);
        }

        return allDoctors.filter(isPendingDoctor);
    }

    function renderAdminCounts(allDoctors, pendingDoctors) {
        const approvedDoctors = allDoctors.filter((doctor) => {
            const status = String(doctor._status || "").toLowerCase();
            return status === "approved" || status === "active";
        });

        const rejectedDoctors = allDoctors.filter((doctor) => {
            const status = String(doctor._status || "").toLowerCase();
            return status === "rejected";
        });

        const pendingDoctorsCount = document.getElementById("pendingDoctorsCount");
        const approvedDoctorsCount = document.getElementById("approvedDoctorsCount");
        const rejectedDoctorsCount = document.getElementById("rejectedDoctorsCount");

        if (pendingDoctorsCount) {
            pendingDoctorsCount.textContent = pendingDoctors.length;
        }

        if (approvedDoctorsCount) {
            approvedDoctorsCount.textContent = approvedDoctors.length;
        }

        if (rejectedDoctorsCount) {
            rejectedDoctorsCount.textContent = rejectedDoctors.length;
        }

        const adminSummaryCards = document.getElementById("adminSummaryCards");

        if (adminSummaryCards) {
            adminSummaryCards.innerHTML = `
                <div class="finance-card">
                    <span>Pending Doctors</span>
                    <strong>${pendingDoctors.length}</strong>
                </div>

                <div class="finance-card">
                    <span>Approved Doctors</span>
                    <strong>${approvedDoctors.length}</strong>
                </div>

                <div class="finance-card">
                    <span>Rejected Doctors</span>
                    <strong>${rejectedDoctors.length}</strong>
                </div>

                <div class="finance-card">
                    <span>Total Doctors</span>
                    <strong>${allDoctors.length}</strong>
                </div>
            `;
        }
    }

    function renderPendingDoctors(doctors) {
        const list = document.getElementById("pendingDoctorsList");

        if (!list) {
            return;
        }

        if (!doctors.length) {
            list.innerHTML = `<p class="muted-text">No pending doctor requests.</p>`;
            return;
        }

        list.innerHTML = doctors.map((doctor) => `
            <div class="compact-item doctor-card" data-doctor-id="${doctor._doctor_id || ""}">
                <strong>${doctor._name}</strong>
                <span>Email: ${doctor.email || doctor.login_email || "N/A"}</span>
                <span>CNIC: ${doctor.cnic || "N/A"}</span>
                <span>Phone: ${doctor.phone || "N/A"}</span>
                <span>Specialization: ${doctor.specialization || "N/A"}</span>
                <span>License: ${doctor.license_number || doctor.license || "N/A"}</span>
                <span>Status: ${doctor._status}</span>

                <div class="queue-card-actions">
                    <button type="button" data-admin-action="approve-doctor">
                        Approve
                    </button>

                    <button type="button" class="danger-button" data-admin-action="reject-doctor">
                        Reject
                    </button>
                </div>
            </div>
        `).join("");
    }

    function renderAllDoctors(doctors) {
        const list = document.getElementById("allDoctorsList");

        if (!list) {
            return;
        }

        if (!doctors.length) {
            list.innerHTML = `<p class="muted-text">No doctors found.</p>`;
            return;
        }

        list.innerHTML = doctors.map((doctor) => `
            <div class="compact-item doctor-card" data-doctor-id="${doctor._doctor_id || ""}">
                <strong>${doctor._name}</strong>
                <span>Email: ${doctor.email || doctor.login_email || "N/A"}</span>
                <span>CNIC: ${doctor.cnic || "N/A"}</span>
                <span>Phone: ${doctor.phone || "N/A"}</span>
                <span>Specialization: ${doctor.specialization || "N/A"}</span>
                <span>License: ${doctor.license_number || doctor.license || "N/A"}</span>
                <span>Status: ${doctor._status}</span>
                <span>Settings Completed: ${doctor.settings_completed ? "Yes" : "No"}</span>
            </div>
        `).join("");
    }

    async function loadAdminDashboard() {
        if (!roleIs("admin")) {
            return;
        }

        if (adminLoading || !canRun("admin-load", 1000)) {
            return;
        }

        adminLoading = true;

        try {
            setAdminMessage("Loading admin data...", "pending");

            const allDoctors = await fetchAllDoctors();
            const pendingDoctors = await fetchPendingDoctors(allDoctors);

            renderAdminCounts(allDoctors, pendingDoctors);
            renderPendingDoctors(pendingDoctors);
            renderAllDoctors(allDoctors);

            setAdminMessage("Admin data loaded.", "ok");
        } catch (error) {
            setAdminMessage(error.message, "error");
        } finally {
            adminLoading = false;
        }
    }

    async function tryAdminAction(urls, options) {
        let lastError = null;

        for (const url of urls) {
            try {
                return await apiRequest(url, options);
            } catch (error) {
                lastError = error;
            }
        }

        throw lastError || new Error("Admin action failed.");
    }

    async function handleAdminAction(event) {
        const button = event.target.closest("[data-admin-action], [data-action='approve-doctor'], [data-action='reject-doctor']");

        if (!button) {
            return;
        }

        event.preventDefault();

        const card = button.closest("[data-doctor-id]");

        if (!card) {
            setAdminMessage("Doctor ID not found.", "error");
            return;
        }

        const selectedDoctorId = card.getAttribute("data-doctor-id");

        if (!selectedDoctorId) {
            setAdminMessage("Doctor ID missing.", "error");
            return;
        }

        const action = button.getAttribute("data-admin-action") || button.getAttribute("data-action");

        try {
            if (action === "approve-doctor") {
                setAdminMessage("Approving doctor...", "pending");

                await tryAdminAction([
                    `/api/admin/doctors/${selectedDoctorId}/approve`,
                    `/api/admin/doctor-requests/${selectedDoctorId}/approve`
                ], {
                    method: "POST"
                });

                setAdminMessage("Doctor approved.", "ok");
            }

            if (action === "reject-doctor") {
                const reason = window.prompt("Reason for rejection", "Incomplete or invalid information");

                if (reason === null) {
                    return;
                }

                setAdminMessage("Rejecting doctor...", "pending");

                await tryAdminAction([
                    `/api/admin/doctors/${selectedDoctorId}/reject`,
                    `/api/admin/doctor-requests/${selectedDoctorId}/reject`
                ], {
                    method: "POST",
                    headers: {
                        "Content-Type": "application/json"
                    },
                    body: JSON.stringify({
                        rejection_reason: reason,
                        reason: reason
                    })
                });

                setAdminMessage("Doctor rejected.", "ok");
            }

            cooldowns["admin-load"] = 0;
            await loadAdminDashboard();
        } catch (error) {
            setAdminMessage(error.message, "error");
        }
    }

    function assignmentId(assignment) {
        return assignment.assignment_id || assignment.doctor_pa_id || assignment.id || assignment.link_id;
    }

    function assignmentDoctorName(assignment) {
        return assignment.doctor_name || assignment.name || assignment.full_name || "Doctor";
    }

    function assignmentHospitalName(assignment) {
        return assignment.hospital_name || assignment.doctor_hospital_name || assignment.clinic_name || "Hospital";
    }

    function normalizeAssignments(assignments) {
        return assignments.map((assignment) => ({
            ...assignment,
            _assignment_id: assignmentId(assignment),
            _doctor_name: assignmentDoctorName(assignment),
            _hospital_name: assignmentHospitalName(assignment)
        }));
    }

    async function fetchPaAssignments() {
        const endpoints = [
            "/api/pa/assignments",
            "/api/pa/me"
        ];

        let lastError = null;

        for (const endpoint of endpoints) {
            try {
                const result = await apiRequest(endpoint);

                let assignments = extractArray(result, [
                    "assignments",
                    "pa_assignments",
                    "links",
                    "doctor_links",
                    "doctor_hospitals"
                ]);

                if (!assignments.length && result.data && Array.isArray(result.data.assignments)) {
                    assignments = result.data.assignments;
                }

                if (assignments.length) {
                    return normalizeAssignments(assignments);
                }
            } catch (error) {
                lastError = error;
                console.log("PA_ASSIGNMENTS_WARNING:", endpoint, error.message);
            }
        }

        if (lastError) {
            throw lastError;
        }

        return [];
    }

    function renderPaAssignments(assignments) {
        allByIds("paAssignmentsList").forEach((list) => {
            if (!assignments.length) {
                list.innerHTML = `<p class="muted-text">No assigned doctors found. Make sure the doctor has invited/linked this PA.</p>`;
                return;
            }

            list.innerHTML = assignments.map((assignment) => `
                <div class="compact-item assignment-card" data-assignment-id="${assignment._assignment_id || ""}">
                    <strong>${assignment._doctor_name}</strong>
                    <span>Specialization: ${assignment.specialization || "N/A"}</span>
                    <span>Hospital: ${assignment._hospital_name}${assignment.hospital_city ? " - " + assignment.hospital_city : ""}</span>
                    <span>Address: ${assignment.hospital_address || assignment.address || "N/A"}</span>
                    <span>Fee: ${money(assignment.consultation_fee || assignment.default_fee || assignment.fee || 0)}</span>
                    <span>Duration: ${assignment.default_consultation_minutes || assignment.duration_minutes || 15} minutes</span>
                    <span>Status: ${assignment.is_active === false ? "Inactive" : "Active"}</span>
                </div>
            `).join("");
        });
    }

    function renderPaAssignmentOptions(assignments) {
        const options =
            `<option value="">Select doctor assignment</option>` +
            assignments.map((assignment) => `
                <option value="${assignment._assignment_id || ""}">
                    ${assignment._doctor_name} - ${assignment._hospital_name}
                </option>
            `).join("");

        allByIds("appointmentAssignment", "paAppointmentAssignment", "paAssignmentSelect").forEach((select) => {
            const oldValue = select.value;

            select.innerHTML = options;

            if (oldValue) {
                select.value = oldValue;
            }
        });
    }

    async function loadPaWorkspace() {
        if (!roleIs("pa")) {
            return;
        }

        if (paLoading || !canRun("pa-load", 1000)) {
            return;
        }

        paLoading = true;

        try {
            setPaMessage("Loading PA data...", "pending");

            const assignments = await fetchPaAssignments();

            renderPaAssignments(assignments);
            renderPaAssignmentOptions(assignments);

            setPaMessage("PA data loaded.", "ok");
        } catch (error) {
            setPaMessage(error.message, "error");
        } finally {
            paLoading = false;
        }
    }

    async function loadPaAppointments() {
        if (!roleIs("pa")) {
            return;
        }

        if (paAppointmentsLoading || !canRun("pa-appointments", 1000)) {
            return;
        }

        const list = document.getElementById("paAppointmentsList");

        if (!list) {
            return;
        }

        const dateInput = byId("paAppointmentsDate", "appointmentDate");
        const date = dateInput && dateInput.value ? dateInput.value : todayIsoDate();

        if (dateInput && !dateInput.value) {
            dateInput.value = date;
        }

        paAppointmentsLoading = true;

        try {
            const result = await apiRequest(`/api/pa/appointments?date=${date}`);
            const appointments = extractArray(result, ["appointments", "pa_appointments"]);

            if (!appointments.length) {
                list.innerHTML = `<p class="muted-text">No appointments found for ${date}.</p>`;
                return;
            }

            list.innerHTML = appointments.map((appointment) => `
                <div class="compact-item">
                    <strong>${appointment.patient_name || appointment.name || "Patient"}</strong>
                    <span>CNIC: ${appointment.patient_cnic || appointment.cnic || "N/A"}</span>
                    <span>Doctor: ${appointment.doctor_name || "N/A"}</span>
                    <span>Hospital: ${appointment.hospital_name || "N/A"}${appointment.hospital_city ? " - " + appointment.hospital_city : ""}</span>
                    <span>Time: ${formatDateTime(appointment.appointment_datetime || appointment.scheduled_start)}</span>
                    <span>Fee: ${money(appointment.fee_charged)} (${appointment.fee_status || "N/A"})</span>
                    <span>Status: ${appointment.status || "N/A"}</span>
                    <span>Source: ${appointment.source || "walk_in"}</span>
                </div>
            `).join("");
        } catch (error) {
            list.innerHTML = `<p class="muted-text">${error.message}</p>`;
        } finally {
            paAppointmentsLoading = false;
        }
    }

    document.addEventListener("click", (event) => {
        const doctorTab = event.target.closest("[data-doctor-tab]");
        const paTab = event.target.closest("[data-pa-tab]");
        const adminTab = event.target.closest("[data-admin-tab]");
        const patientTab = event.target.closest("[data-patient-tab]");

        if (doctorTab) {
            event.preventDefault();

            activateTab(
                doctorTab.closest("#doctorDashboard"),
                doctorTab,
                "[data-doctor-tab]",
                ".doctor-module-panel",
                "data-doctor-tab"
            );

            return;
        }

        if (paTab) {
            event.preventDefault();

            activateTab(
                paTab.closest("#paDashboard"),
                paTab,
                "[data-pa-tab]",
                ".pa-module-panel",
                "data-pa-tab"
            );

            return;
        }

        if (adminTab) {
            event.preventDefault();

            activateTab(
                adminTab.closest("#adminDashboard"),
                adminTab,
                "[data-admin-tab]",
                ".admin-module-panel",
                "data-admin-tab"
            );

            return;
        }

        if (patientTab) {
            event.preventDefault();

            activateTab(
                patientTab.closest("#patientDashboard"),
                patientTab,
                "[data-patient-tab]",
                ".patient-module-panel",
                "data-patient-tab"
            );

            return;
        }

        const button = event.target.closest("button");

        if (!button) {
            return;
        }

        if (
            button.id === "refreshPendingDoctorsButton" ||
            button.id === "refreshAdminDashboardButton" ||
            button.id === "refreshAdminButton"
        ) {
            event.preventDefault();
            cooldowns["admin-load"] = 0;
            loadAdminDashboard();
            return;
        }

        if (
            button.id === "refreshPaWorkspaceButton" ||
            button.id === "refreshPaDashboardButton"
        ) {
            event.preventDefault();
            cooldowns["pa-load"] = 0;
            cooldowns["pa-appointments"] = 0;
            loadPaWorkspace();
            loadPaAppointments();
        }
    });

    document.addEventListener("click", handleAdminAction);

    const paAppointmentsDate = byId("paAppointmentsDate", "appointmentDate");

    if (paAppointmentsDate) {
        paAppointmentsDate.addEventListener("change", () => {
            cooldowns["pa-appointments"] = 0;
            loadPaAppointments();
        });
    }

    document.querySelectorAll(".doctor-module-tab, .pa-module-tab, .admin-module-tab, .patient-module-tab, .tab-button").forEach((button) => {
        button.setAttribute("type", "button");
        button.style.pointerEvents = "auto";
        button.style.cursor = "pointer";
    });

    window.HM_LOAD_ADMIN_DASHBOARD = loadAdminDashboard;
    window.HM_LOAD_PA_WORKSPACE = loadPaWorkspace;
    window.HM_LOAD_PA_APPOINTMENTS = loadPaAppointments;

    setTimeout(() => {
        if (firstLoadDone) {
            return;
        }

        firstLoadDone = true;

        if (roleIs("admin")) {
            loadAdminDashboard();
            return;
        }

        if (roleIs("pa")) {
            loadPaWorkspace();
            loadPaAppointments();
        }
    }, 800);
});