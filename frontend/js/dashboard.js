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

    let doctorHospitalsCache = [];

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

    const doctorModuleTabs = document.querySelectorAll(".doctor-module-tab");
    const doctorModulePanels = document.querySelectorAll(".doctor-module-panel");

    const refreshDoctorSettingsButton = document.getElementById("refreshDoctorSettingsButton");
    const doctorSettingsMessage = document.getElementById("doctorSettingsMessage");

    const hospitalForm = document.getElementById("hospitalForm");
    const hospitalName = document.getElementById("hospitalName");
    const hospitalAddress = document.getElementById("hospitalAddress");
    const hospitalCity = document.getElementById("hospitalCity");

    const scheduleForm = document.getElementById("scheduleForm");
    const scheduleHospital = document.getElementById("scheduleHospital");
    const scheduleStartTime = document.getElementById("scheduleStartTime");
    const scheduleEndTime = document.getElementById("scheduleEndTime");
    const scheduleDuration = document.getElementById("scheduleDuration");
    const scheduleFee = document.getElementById("scheduleFee");

    const formFieldForm = document.getElementById("formFieldForm");
    const fieldContext = document.getElementById("fieldContext");
    const fieldLabel = document.getElementById("fieldLabel");
    const fieldType = document.getElementById("fieldType");
    const fieldPlaceholder = document.getElementById("fieldPlaceholder");
    const fieldHelpText = document.getElementById("fieldHelpText");
    const fieldRequired = document.getElementById("fieldRequired");

    const doctorHospitalsList = document.getElementById("doctorHospitalsList");
    const doctorSchedulesList = document.getElementById("doctorSchedulesList");
    const doctorFieldsList = document.getElementById("doctorFieldsList");
    const completeSettingsButton = document.getElementById("completeSettingsButton");

    const refreshPaDataButton = document.getElementById("refreshPaDataButton");
    const paMessage = document.getElementById("paMessage");
    const paInviteForm = document.getElementById("paInviteForm");
    const paInviteHospital = document.getElementById("paInviteHospital");
    const paInviteCnic = document.getElementById("paInviteCnic");
    const paInviteEmail = document.getElementById("paInviteEmail");
    const linkedPaList = document.getElementById("linkedPaList");
    const paInviteList = document.getElementById("paInviteList");
    const latestInviteBox = document.getElementById("latestInviteBox");

    const dayNames = {
        0: "Sunday",
        1: "Monday",
        2: "Tuesday",
        3: "Wednesday",
        4: "Thursday",
        5: "Friday",
        6: "Saturday"
    };

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

    async function apiRequest(path, options = {}) {
        const headers = options.headers || {};
        headers["Authorization"] = `Bearer ${token}`;

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

    function capitalize(value) {
        if (!value) {
            return "";
        }

        return value.charAt(0).toUpperCase() + value.slice(1);
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
            loadDoctorSettings();
        }

        if (user.role === "pa") {
            paDashboard.classList.remove("hidden");
        }

        if (user.role === "patient") {
            patientDashboard.classList.remove("hidden");
        }
    }

    async function verifySession() {
        try {
            await apiRequest("/api/auth/me");
        } catch (error) {
            logout();
        }
    }

    function switchDoctorModule(tabId) {
        doctorModuleTabs.forEach((tab) => {
            tab.classList.remove("active");

            if (tab.getAttribute("data-doctor-tab") === tabId) {
                tab.classList.add("active");
            }
        });

        doctorModulePanels.forEach((panel) => {
            panel.classList.add("hidden");

            if (panel.id === tabId) {
                panel.classList.remove("hidden");
            }
        });

        if (tabId === "doctorPaTab") {
            loadDoctorPaData();
        }

        if (tabId === "doctorSettingsTab") {
            loadDoctorSettings();
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

    async function loadDoctorSettings() {
        try {
            showMessage(doctorSettingsMessage, "Loading doctor settings...", "pending");

            const result = await apiRequest("/api/doctor/settings");
            const data = result.data;

            doctorHospitalsCache = data.hospitals || [];

            renderDoctorHospitals(data.hospitals || []);
            renderDoctorSchedules(data.schedules || []);
            renderDoctorFields(data.form_fields || []);
            renderPaHospitalOptions(data.hospitals || []);

            showMessage(doctorSettingsMessage, "Doctor settings loaded.", "ok");
        } catch (error) {
            showMessage(doctorSettingsMessage, error.message, "error");
        }
    }

    function renderDoctorHospitals(hospitals) {
        if (!hospitals.length) {
            doctorHospitalsList.innerHTML = `<p class="muted-text">No hospitals/clinics added yet.</p>`;
            scheduleHospital.innerHTML = `<option value="">Select hospital</option>`;
            return;
        }

        doctorHospitalsList.innerHTML = hospitals.map((hospital) => {
            return `
                <div class="compact-item">
                    <strong>${hospital.name}</strong>
                    <span>${hospital.address || "No address"}</span>
                    <span>${hospital.city || "No city"}</span>
                </div>
            `;
        }).join("");

        scheduleHospital.innerHTML = `<option value="">Select hospital</option>` + hospitals.map((hospital) => {
            return `<option value="${hospital.id}">${hospital.name} - ${hospital.city || ""}</option>`;
        }).join("");
    }

    function renderPaHospitalOptions(hospitals) {
        if (!paInviteHospital) {
            return;
        }

        if (!hospitals.length) {
            paInviteHospital.innerHTML = `<option value="">Add hospital first</option>`;
            return;
        }

        paInviteHospital.innerHTML = `<option value="">Select hospital</option>` + hospitals.map((hospital) => {
            return `<option value="${hospital.id}">${hospital.name} - ${hospital.city || ""}</option>`;
        }).join("");
    }

    function formatTime(value) {
        if (!value) {
            return "";
        }

        return String(value).slice(0, 5);
    }

    function renderDoctorSchedules(schedules) {
        if (!schedules.length) {
            doctorSchedulesList.innerHTML = `<p class="muted-text">No schedules added yet.</p>`;
            return;
        }

        doctorSchedulesList.innerHTML = schedules.map((schedule) => {
            return `
                <div class="compact-item schedule-item" data-schedule-id="${schedule.schedule_id}">
                    <div class="compact-item-top">
                        <strong>${schedule.hospital_name}</strong>

                        <button
                            type="button"
                            class="icon-button delete-schedule-button"
                            title="Delete schedule"
                            aria-label="Delete schedule"
                        >
                            🗑
                        </button>
                    </div>

                    <span>${dayNames[schedule.day_of_week]}: ${formatTime(schedule.start_time)} - ${formatTime(schedule.end_time)}</span>
                    <span>Duration: ${schedule.default_consultation_minutes} minutes</span>
                    <span>Fee: ${schedule.consultation_fee}</span>
                </div>
            `;
        }).join("");
    }

    function renderDoctorFields(fields) {
        if (!fields.length) {
            doctorFieldsList.innerHTML = `<p class="muted-text">No dynamic fields added yet.</p>`;
            return;
        }

        doctorFieldsList.innerHTML = fields.map((field) => {
            const contextLabel = field.field_context === "patient_intake"
                ? "PA Intake"
                : "Consultation";

            return `
                <div class="compact-item">
                    <strong>${field.field_label}</strong>
                    <span>Context: ${contextLabel}</span>
                    <span>Type: ${field.field_type}</span>
                    <span>Required: ${field.is_required ? "Yes" : "No"}</span>
                </div>
            `;
        }).join("");
    }

    async function submitHospital(event) {
        event.preventDefault();

        try {
            showMessage(doctorSettingsMessage, "Adding hospital...", "pending");

            const payload = {
                name: hospitalName.value.trim(),
                address: hospitalAddress.value.trim(),
                city: hospitalCity.value.trim()
            };

            const result = await apiRequest("/api/doctor/hospitals", {
                method: "POST",
                headers: {
                    "Content-Type": "application/json"
                },
                body: JSON.stringify(payload)
            });

            showMessage(doctorSettingsMessage, result.message, "ok");
            hospitalForm.reset();
            await loadDoctorSettings();
        } catch (error) {
            showMessage(doctorSettingsMessage, error.message, "error");
        }
    }

    function getSelectedScheduleDays() {
        const checkedBoxes = document.querySelectorAll('input[name="scheduleDay"]:checked');
        return Array.from(checkedBoxes).map((checkbox) => Number(checkbox.value));
    }

    function clearSelectedScheduleDays() {
        const checkedBoxes = document.querySelectorAll('input[name="scheduleDay"]:checked');

        checkedBoxes.forEach((checkbox) => {
            checkbox.checked = false;
        });
    }

    async function submitSchedule(event) {
        event.preventDefault();

        try {
            showMessage(doctorSettingsMessage, "Adding schedule...", "pending");

            const hospitalId = scheduleHospital.value;
            const selectedDays = getSelectedScheduleDays();

            if (!hospitalId) {
                showMessage(doctorSettingsMessage, "Please select a hospital.", "error");
                return;
            }

            if (!selectedDays.length) {
                showMessage(doctorSettingsMessage, "Please select at least one day.", "error");
                return;
            }

            const payload = {
                day_of_weeks: selectedDays,
                start_time: scheduleStartTime.value,
                end_time: scheduleEndTime.value,
                default_consultation_minutes: Number(scheduleDuration.value),
                consultation_fee: Number(scheduleFee.value)
            };

            const result = await apiRequest(`/api/doctor/hospitals/${hospitalId}/schedules`, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json"
                },
                body: JSON.stringify(payload)
            });

            showMessage(doctorSettingsMessage, result.message, "ok");

            scheduleForm.reset();
            clearSelectedScheduleDays();
            scheduleDuration.value = 15;
            scheduleFee.value = 0;

            await loadDoctorSettings();
        } catch (error) {
            showMessage(doctorSettingsMessage, error.message, "error");
        }
    }

    async function deleteSchedule(scheduleId) {
        const confirmed = window.confirm("Delete this schedule entry?");

        if (!confirmed) {
            return;
        }

        try {
            showMessage(doctorSettingsMessage, "Deleting schedule...", "pending");

            const result = await apiRequest(`/api/doctor/schedules/${scheduleId}`, {
                method: "DELETE"
            });

            showMessage(doctorSettingsMessage, result.message, "ok");
            await loadDoctorSettings();
        } catch (error) {
            showMessage(doctorSettingsMessage, error.message, "error");
        }
    }

    function handleScheduleListClick(event) {
        const deleteButton = event.target.closest(".delete-schedule-button");

        if (!deleteButton) {
            return;
        }

        const scheduleCard = event.target.closest(".schedule-item");

        if (!scheduleCard) {
            return;
        }

        const scheduleId = scheduleCard.getAttribute("data-schedule-id");

        if (!scheduleId) {
            showMessage(doctorSettingsMessage, "Schedule ID not found.", "error");
            return;
        }

        deleteSchedule(scheduleId);
    }

    async function submitFormField(event) {
        event.preventDefault();

        try {
            showMessage(doctorSettingsMessage, "Adding form field...", "pending");

            const payload = {
                field_context: fieldContext.value,
                field_label: fieldLabel.value.trim(),
                field_type: fieldType.value,
                is_required: fieldRequired.checked,
                placeholder: fieldPlaceholder.value.trim(),
                help_text: fieldHelpText.value.trim(),
                display_order: 0,
                options: null
            };

            const result = await apiRequest("/api/doctor/form-fields", {
                method: "POST",
                headers: {
                    "Content-Type": "application/json"
                },
                body: JSON.stringify(payload)
            });

            showMessage(doctorSettingsMessage, result.message, "ok");
            formFieldForm.reset();
            await loadDoctorSettings();
        } catch (error) {
            showMessage(doctorSettingsMessage, error.message, "error");
        }
    }

    async function completeDoctorSettings() {
        try {
            showMessage(doctorSettingsMessage, "Completing settings...", "pending");

            const result = await apiRequest("/api/doctor/settings/complete", {
                method: "POST"
            });

            showMessage(doctorSettingsMessage, result.message, "ok");
            await loadDoctorSettings();
        } catch (error) {
            showMessage(doctorSettingsMessage, error.message, "error");
        }
    }

    function buildInviteLink(inviteToken) {
        const currentPath = window.location.pathname;
        const basePath = currentPath.replace("dashboard.html", "pa-register.html");
        return `${window.location.origin}${basePath}?token=${inviteToken}`;
    }

    async function submitPaInvite(event) {
        event.preventDefault();

        try {
            showMessage(paMessage, "Processing PA invite/link request...", "pending");
            latestInviteBox.classList.add("hidden");
            latestInviteBox.innerHTML = "";

            const payload = {
                doctor_hospital_id: Number(paInviteHospital.value),
                cnic: paInviteCnic.value.trim(),
                email: paInviteEmail.value.trim()
            };

            if (!payload.doctor_hospital_id) {
                showMessage(paMessage, "Please select a hospital.", "error");
                return;
            }

            const result = await apiRequest("/api/doctor/pa-invites", {
                method: "POST",
                headers: {
                    "Content-Type": "application/json"
                },
                body: JSON.stringify(payload)
            });

            showMessage(paMessage, result.message, "ok");

            if (result.mode === "invite_created") {
                const inviteToken = result.data.invite.invite_token;
                const inviteLink = buildInviteLink(inviteToken);

                latestInviteBox.classList.remove("hidden");
                latestInviteBox.innerHTML = `
                    <strong>Invite Link Created</strong>
                    <p>Share this link with the PA:</p>
                    <div class="invite-link-row">
                        <input type="text" value="${inviteLink}" readonly>
                        <button type="button" class="secondary-button copy-link-button" data-copy-link="${inviteLink}">
                            Copy
                        </button>
                    </div>
                `;
            }

            paInviteForm.reset();
            renderPaHospitalOptions(doctorHospitalsCache);

            await loadDoctorPaData();
        } catch (error) {
            showMessage(paMessage, error.message, "error");
        }
    }

    async function loadDoctorPaData() {
        try {
            showMessage(paMessage, "Loading PA data...", "pending");

            if (!doctorHospitalsCache.length) {
                await loadDoctorSettings();
            } else {
                renderPaHospitalOptions(doctorHospitalsCache);
            }

            const linksResult = await apiRequest("/api/doctor/pa-links");
            const invitesResult = await apiRequest("/api/doctor/pa-invites");

            renderLinkedPas(linksResult.data || []);
            renderPaInvites(invitesResult.data || []);

            showMessage(paMessage, "PA data loaded.", "ok");
        } catch (error) {
            showMessage(paMessage, error.message, "error");
        }
    }

    function renderLinkedPas(links) {
        if (!links.length) {
            linkedPaList.innerHTML = `<p class="muted-text">No linked PAs yet.</p>`;
            return;
        }

        linkedPaList.innerHTML = links.map((link) => {
            return `
                <div class="compact-item">
                    <strong>${link.full_name || "Unnamed PA"}</strong>
                    <span>CNIC: ${link.cnic}</span>
                    <span>Email: ${link.email || "No email"}</span>
                    <span>Phone: ${link.phone || "No phone"}</span>
                    <span>Hospital: ${link.hospital_name} - ${link.hospital_city || ""}</span>
                    <span>Status: ${link.account_status || "N/A"}</span>
                </div>
            `;
        }).join("");
    }

    function renderPaInvites(invites) {
        if (!invites.length) {
            paInviteList.innerHTML = `<p class="muted-text">No PA invites yet.</p>`;
            return;
        }

        paInviteList.innerHTML = invites.map((invite) => {
            const inviteLink = buildInviteLink(invite.invite_token);
            const showCopy = invite.status === "pending";

            return `
                <div class="compact-item pa-invite-item">
                    <strong>${invite.invited_email}</strong>
                    <span>CNIC: ${invite.invited_cnic}</span>
                    <span>Hospital: ${invite.hospital_name} - ${invite.hospital_city || ""}</span>
                    <span>Status: ${invite.status}</span>

                    ${showCopy ? `
                        <div class="invite-link-row compact-copy-row">
                            <input type="text" value="${inviteLink}" readonly>
                            <button type="button" class="secondary-button copy-link-button" data-copy-link="${inviteLink}">
                                Copy
                            </button>
                        </div>
                    ` : ""}
                </div>
            `;
        }).join("");
    }

    async function copyText(value) {
        try {
            await navigator.clipboard.writeText(value);
            showMessage(paMessage, "Invite link copied.", "ok");
        } catch (error) {
            const tempInput = document.createElement("input");
            tempInput.value = value;
            document.body.appendChild(tempInput);
            tempInput.select();
            document.execCommand("copy");
            document.body.removeChild(tempInput);
            showMessage(paMessage, "Invite link copied.", "ok");
        }
    }

    function handleCopyClick(event) {
        const button = event.target.closest(".copy-link-button");

        if (!button) {
            return;
        }

        const link = button.getAttribute("data-copy-link");

        if (!link) {
            showMessage(paMessage, "Invite link not found.", "error");
            return;
        }

        copyText(link);
    }

    logoutButton.addEventListener("click", logout);

    doctorModuleTabs.forEach((tab) => {
        tab.addEventListener("click", () => {
            switchDoctorModule(tab.getAttribute("data-doctor-tab"));
        });
    });

    if (refreshPendingDoctorsButton) {
        refreshPendingDoctorsButton.addEventListener("click", loadAdminDashboard);
    }

    if (pendingDoctorsList) {
        pendingDoctorsList.addEventListener("click", handleDoctorListClick);
    }

    if (refreshDoctorSettingsButton) {
        refreshDoctorSettingsButton.addEventListener("click", loadDoctorSettings);
    }

    if (hospitalForm) {
        hospitalForm.addEventListener("submit", submitHospital);
    }

    if (scheduleForm) {
        scheduleForm.addEventListener("submit", submitSchedule);
    }

    if (doctorSchedulesList) {
        doctorSchedulesList.addEventListener("click", handleScheduleListClick);
    }

    if (formFieldForm) {
        formFieldForm.addEventListener("submit", submitFormField);
    }

    if (completeSettingsButton) {
        completeSettingsButton.addEventListener("click", completeDoctorSettings);
    }

    if (paInviteForm) {
        paInviteForm.addEventListener("submit", submitPaInvite);
    }

    if (refreshPaDataButton) {
        refreshPaDataButton.addEventListener("click", loadDoctorPaData);
    }

    if (latestInviteBox) {
        latestInviteBox.addEventListener("click", handleCopyClick);
    }

    if (paInviteList) {
        paInviteList.addEventListener("click", handleCopyClick);
    }

    verifySession();
    renderDashboardByRole();

    setInterval(() => {
        if (user.role === "admin") {
            loadAdminSummary();
        }
    }, 30000);
});