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

    let settingsCache = {
        hospitals: [],
        schedules: [],
        fields: [],
        paLinks: [],
        paInvites: []
    };

    let settingsLoading = false;
    let paDataLoading = false;
    let initialDoctorLoadDone = false;

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

    function isDoctor() {
        const user = getUser();
        return user && user.role === "doctor";
    }

    function doctorDashboardIsVisible() {
        const doctorDashboard = document.getElementById("doctorDashboard");

        return doctorDashboard && !doctorDashboard.classList.contains("hidden");
    }

    function shouldWorkNow() {
        return isDoctor() && doctorDashboardIsVisible();
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

    function setMessage(message, type) {
        const box = byId(
            "doctorSettingsMessage",
            "doctorDashboardMessage",
            "paMessage",
            "dashboardMessage"
        );

        if (!box) {
            return;
        }

        box.textContent = message || "";
        box.classList.remove("ok", "error", "pending");

        if (type) {
            box.classList.add(type);
        }
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
            console.log("DOCTOR_SETTINGS_API_ERROR:", path, result);
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

    function slugify(value) {
        return String(value || "")
            .toLowerCase()
            .trim()
            .replace(/[^a-z0-9]+/g, "_")
            .replace(/^_+|_+$/g, "");
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

    function hospitalId(hospital) {
        return hospital.id || hospital.doctor_hospital_id || hospital.hospital_id;
    }

    function hospitalName(hospital) {
        return hospital.name || hospital.hospital_name || "Unnamed Hospital";
    }

    function scheduleId(schedule) {
        return schedule.schedule_id || schedule.id || schedule.doctor_hospital_schedule_id;
    }

    function buildPaInviteLink(token) {
        if (!token) {
            return "";
        }

        const basePath = window.location.pathname.replace("dashboard.html", "");

        return `${window.location.origin}${basePath}pa-register.html?token=${token}`;
    }

    function renderClickableInviteLink(link) {
    if (!link) {
        return `<span class="muted-text">Invite token not available.</span>`;
    }

    return `
        <div class="invite-link-row" style="display:flex; flex-direction:column; gap:8px; margin-top:10px;">
            <button
                type="button"
                class="primary-auth-link pa-invite-open-button"
                data-pa-invite-url="${link}"
                style="display:inline-block; width:max-content; pointer-events:auto; position:relative; z-index:999;"
            >
                Open PA Registration Link
            </button>

            <input
                type="text"
                readonly
                value="${link}"
                class="pa-invite-link-input"
                onclick="this.select();"
                style="cursor:text; pointer-events:auto; position:relative; z-index:999;"
            >
        </div>
    `;
}

    function enforceScheduleTimePickers() {
        allByIds(
            "scheduleStartTime",
            "scheduleEndTime",
            "doctorScheduleStart",
            "doctorScheduleEnd"
        ).forEach((input) => {
            input.setAttribute("type", "time");
            input.setAttribute("step", "60");
            input.removeAttribute("placeholder");
        });
    }

    function getSelectedDays() {
        const oldDays = Array.from(document.querySelectorAll("input[name='scheduleDay']:checked"))
            .map((checkbox) => Number(checkbox.value));

        const newDays = Array.from(document.querySelectorAll("#doctorScheduleDays input[type='checkbox']:checked"))
            .map((checkbox) => Number(checkbox.value));

        return Array.from(new Set([...oldDays, ...newDays]));
    }

    function extractData(result) {
        return result.data || result || {};
    }

    async function loadDoctorSettings() {
        if (!shouldWorkNow()) {
            return;
        }

        if (settingsLoading) {
            return;
        }

        settingsLoading = true;

        try {
            setMessage("Loading doctor settings...", "pending");

            const result = await apiRequest("/api/doctor/settings");
            const data = extractData(result);

            settingsCache.hospitals =
                data.hospitals ||
                data.doctor_hospitals ||
                data.doctorHospitals ||
                [];

            settingsCache.schedules =
                data.schedules ||
                data.hospital_schedules ||
                data.doctor_hospital_schedules ||
                [];

            settingsCache.fields =
                data.form_fields ||
                data.formFields ||
                data.dynamic_fields ||
                [];

            renderHospitals();
            renderHospitalSelects();
            renderSchedules();
            renderFields();
            enforceScheduleTimePickers();

            setMessage("Doctor settings loaded.", "ok");
        } catch (error) {
            setMessage(error.message, "error");
        } finally {
            settingsLoading = false;
        }
    }

    async function loadDoctorPaData() {
        if (!shouldWorkNow()) {
            return;
        }

        if (paDataLoading) {
            return;
        }

        paDataLoading = true;

        try {
            setMessage("Loading PA data...", "pending");

            try {
                const linksResult = await apiRequest("/api/doctor/pa-links");
                settingsCache.paLinks =
                    linksResult.data ||
                    linksResult.links ||
                    linksResult.pa_links ||
                    [];
            } catch (error) {
                settingsCache.paLinks = [];
                console.log("PA_LINKS_LOAD_WARNING:", error.message);
            }

            try {
                const invitesResult = await apiRequest("/api/doctor/pa-invites");
                settingsCache.paInvites =
                    invitesResult.data ||
                    invitesResult.invites ||
                    invitesResult.pa_invites ||
                    [];
            } catch (error) {
                settingsCache.paInvites = [];
                console.log("PA_INVITES_LOAD_WARNING:", error.message);
            }

            renderPaLinks();
            renderPaInvites();

            setMessage("PA data loaded.", "ok");
        } catch (error) {
            setMessage(error.message, "error");
        } finally {
            paDataLoading = false;
        }
    }

    async function loadAllDoctorSettingsData() {
        await loadDoctorSettings();
        await loadDoctorPaData();
    }

    function renderHospitals() {
        allByIds("doctorHospitalsList").forEach((list) => {
            if (!settingsCache.hospitals.length) {
                list.innerHTML = `<p class="muted-text">No hospitals added yet.</p>`;
                return;
            }

            list.innerHTML = settingsCache.hospitals.map((hospital) => `
                <div class="compact-item">
                    <strong>${hospitalName(hospital)}</strong>
                    <span>City: ${hospital.city || "N/A"}</span>
                    <span>Address: ${hospital.address || "N/A"}</span>
                    <span>Status: ${hospital.is_active === false ? "Inactive" : "Active"}</span>
                </div>
            `).join("");
        });
    }

    function renderHospitalSelects() {
        const options =
            `<option value="">Select hospital</option>` +
            settingsCache.hospitals.map((hospital) => `
                <option value="${hospitalId(hospital)}">
                    ${hospitalName(hospital)}${hospital.city ? " - " + hospital.city : ""}
                </option>
            `).join("");

        allByIds(
            "scheduleHospital",
            "doctorScheduleHospital",
            "paInviteHospital",
            "doctorPaHospital"
        ).forEach((select) => {
            const oldValue = select.value;

            select.innerHTML = options;

            if (oldValue) {
                select.value = oldValue;
            }
        });
    }

    function renderSchedules() {
        allByIds("doctorSchedulesList").forEach((list) => {
            if (!settingsCache.schedules.length) {
                list.innerHTML = `<p class="muted-text">No schedules added yet.</p>`;
                return;
            }

            list.innerHTML = settingsCache.schedules.map((schedule) => {
                const relatedHospital =
                    settingsCache.hospitals.find((hospital) => {
                        return String(hospitalId(hospital)) === String(schedule.doctor_hospital_id);
                    }) || {};

                return `
                    <div class="compact-item" data-schedule-id="${scheduleId(schedule)}">
                        <div class="compact-item-top">
                            <strong>${hospitalName(relatedHospital) || schedule.hospital_name || "Hospital"}</strong>

                            <button type="button" class="icon-button danger-button" data-action="delete-schedule">
                                ✕
                            </button>
                        </div>

                        <span>Day: ${dayName(schedule.day_of_week)}</span>
                        <span>Time: ${String(schedule.start_time || "").slice(0, 5)} - ${String(schedule.end_time || "").slice(0, 5)}</span>
                        <span>Duration: ${schedule.default_consultation_minutes || schedule.duration_minutes || 15} minutes</span>
                        <span>Fee: ${money(schedule.consultation_fee || schedule.fee || 0)}</span>
                    </div>
                `;
            }).join("");
        });
    }

    function renderFields() {
        allByIds("doctorFieldsList").forEach((list) => {
            if (!settingsCache.fields.length) {
                list.innerHTML = `<p class="muted-text">No dynamic fields added yet.</p>`;
                return;
            }

            list.innerHTML = settingsCache.fields.map((field) => `
                <div class="compact-item">
                    <strong>${field.field_label || field.label || "Field"}</strong>
                    <span>Key: ${field.field_key || "N/A"}</span>
                    <span>Type: ${field.field_type || "text"}</span>
                    <span>Context: ${field.field_context || "consultation"}</span>
                    <span>Required: ${field.is_required ? "Yes" : "No"}</span>
                </div>
            `).join("");
        });
    }

    function renderPaLinks() {
        allByIds("linkedPaList", "doctorPaLinksList").forEach((list) => {
            if (!settingsCache.paLinks.length) {
                list.innerHTML = `<p class="muted-text">No linked PAs loaded.</p>`;
                return;
            }

            list.innerHTML = settingsCache.paLinks.map((link) => `
                <div class="compact-item">
                    <strong>${link.full_name || link.pa_name || link.email || "PA"}</strong>
                    <span>CNIC: ${link.cnic || "N/A"}</span>
                    <span>Email: ${link.email || link.pa_email || "N/A"}</span>
                    <span>Hospital: ${link.hospital_name || "N/A"}</span>
                    <span>Status: ${link.is_active === false ? "Inactive" : "Active"}</span>
                </div>
            `).join("");
        });
    }

    function renderPaInvites() {
        allByIds("paInviteList", "doctorPaInvitesList").forEach((list) => {
            if (!settingsCache.paInvites.length) {
                list.innerHTML = `<p class="muted-text">No invites loaded.</p>`;
                return;
            }

            list.innerHTML = settingsCache.paInvites.map((invite) => {
                const token = invite.invite_token;
                const link = buildPaInviteLink(token);

                return `
                    <div class="compact-item">
                        <strong>${invite.email || invite.pa_email || invite.invited_email || "PA Invite"}</strong>
                        <span>CNIC: ${invite.invited_cnic || invite.cnic || "N/A"}</span>
                        <span>Status: ${invite.status || "pending"}</span>

                        ${renderClickableInviteLink(link)}
                    </div>
                `;
            }).join("");
        });
    }

    function scheduleAlreadyExists(hospitalIdValue, dayNumber, startTime, endTime) {
        return settingsCache.schedules.some((schedule) => {
            return (
                String(schedule.doctor_hospital_id) === String(hospitalIdValue) &&
                Number(schedule.day_of_week) === Number(dayNumber) &&
                String(schedule.start_time || "").slice(0, 5) === String(startTime || "").slice(0, 5) &&
                String(schedule.end_time || "").slice(0, 5) === String(endTime || "").slice(0, 5)
            );
        });
    }

    async function addHospital(event) {
        event.preventDefault();
        event.stopImmediatePropagation();

        const nameInput = byId("hospitalName", "doctorHospitalName");
        const cityInput = byId("hospitalCity", "doctorHospitalCity");
        const addressInput = byId("hospitalAddress", "doctorHospitalAddress");

        const name = nameInput ? nameInput.value.trim() : "";
        const city = cityInput ? cityInput.value.trim() : "";
        const address = addressInput ? addressInput.value.trim() : "";

        if (!name) {
            setMessage("Hospital name is required.", "error");
            return;
        }

        try {
            setMessage("Adding hospital...", "pending");

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

            const form = byId("hospitalForm", "doctorHospitalForm");

            if (form) {
                form.reset();
            }

            await loadDoctorSettings();

            setMessage("Hospital added successfully.", "ok");
        } catch (error) {
            setMessage(error.message, "error");
        }
    }

    async function addSchedule(event) {
        event.preventDefault();
        event.stopImmediatePropagation();

        enforceScheduleTimePickers();

        const hospitalSelect = byId("scheduleHospital", "doctorScheduleHospital");
        const startInput = byId("scheduleStartTime", "doctorScheduleStart");
        const endInput = byId("scheduleEndTime", "doctorScheduleEnd");
        const durationInput = byId("scheduleDuration", "doctorScheduleDuration");
        const feeInput = byId("scheduleFee", "doctorScheduleFee");

        const selectedHospital = hospitalSelect ? hospitalSelect.value : "";
        const selectedDays = getSelectedDays();
        const startTime = startInput ? startInput.value : "";
        const endTime = endInput ? endInput.value : "";
        const duration = Number(durationInput ? durationInput.value || 15 : 15);
        const fee = Number(feeInput ? feeInput.value || 0 : 0);

        if (!selectedHospital) {
            setMessage("Select hospital first.", "error");
            return;
        }

        if (!selectedDays.length) {
            setMessage("Select at least one day.", "error");
            return;
        }

        if (!startTime || !endTime) {
            setMessage("Start and end time are required.", "error");
            return;
        }

        if (startTime >= endTime) {
            setMessage("Start time must be before end time.", "error");
            return;
        }

        try {
            setMessage("Adding schedule...", "pending");

            for (const day of selectedDays) {
                if (scheduleAlreadyExists(selectedHospital, day, startTime, endTime)) {
                    throw new Error(`Duplicate schedule found for ${dayName(day)} at the same time.`);
                }

                await apiRequest(`/api/doctor/hospitals/${selectedHospital}/schedules`, {
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

            const form = byId("scheduleForm", "doctorScheduleForm");

            if (form) {
                form.reset();
            }

            enforceScheduleTimePickers();
            await loadDoctorSettings();

            setMessage("Schedule added successfully.", "ok");
        } catch (error) {
            setMessage(error.message, "error");
        }
    }

    async function addField(event) {
        event.preventDefault();
        event.stopImmediatePropagation();

        const labelInput = byId("fieldLabel", "doctorFieldLabel");
        const typeInput = byId("fieldType", "doctorFieldType");
        const contextInput = byId("fieldContext", "doctorFieldContext");
        const requiredInput = byId("fieldRequired", "doctorFieldRequired");
        const placeholderInput = byId("fieldPlaceholder");
        const helpInput = byId("fieldHelpText");

        const label = labelInput ? labelInput.value.trim() : "";
        const type = typeInput ? typeInput.value : "text";
        const context = contextInput ? contextInput.value : "consultation";

        let isRequired = false;

        if (requiredInput) {
            if (requiredInput.type === "checkbox") {
                isRequired = requiredInput.checked;
            } else {
                isRequired = requiredInput.value === "true";
            }
        }

        if (!label) {
            setMessage("Field label is required.", "error");
            return;
        }

        try {
            setMessage("Adding dynamic field...", "pending");

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
                    field_placeholder: placeholderInput ? placeholderInput.value.trim() : "",
                    help_text: helpInput ? helpInput.value.trim() : "",
                    is_required: isRequired,
                    display_order: settingsCache.fields.length + 1
                })
            });

            const form = byId("formFieldForm", "doctorFieldForm");

            if (form) {
                form.reset();
            }

            await loadDoctorSettings();

            setMessage("Dynamic field added successfully.", "ok");
        } catch (error) {
            setMessage(error.message, "error");
        }
    }

    async function deleteSchedule(event) {
        const button = event.target.closest("[data-action='delete-schedule']");

        if (!button) {
            return;
        }

        event.preventDefault();
        event.stopImmediatePropagation();

        const card = button.closest("[data-schedule-id]");

        if (!card) {
            return;
        }

        const currentScheduleId = card.getAttribute("data-schedule-id");

        if (!currentScheduleId) {
            setMessage("Schedule ID missing.", "error");
            return;
        }

        const confirmed = window.confirm("Delete this schedule?");

        if (!confirmed) {
            return;
        }

        try {
            setMessage("Deleting schedule...", "pending");

            await apiRequest(`/api/doctor/schedules/${currentScheduleId}`, {
                method: "DELETE"
            });

            await loadDoctorSettings();

            setMessage("Schedule deleted.", "ok");
        } catch (error) {
            setMessage(error.message, "error");
        }
    }

    async function completeSettings(event) {
        event.preventDefault();
        event.stopImmediatePropagation();

        try {
            setMessage("Marking settings complete...", "pending");

            await apiRequest("/api/doctor/settings/complete", {
                method: "POST"
            });

            setMessage("Settings marked complete.", "ok");
        } catch (error) {
            setMessage(error.message, "error");
        }
    }

    async function invitePa(event) {
        event.preventDefault();
        event.stopImmediatePropagation();

        const hospitalSelect = byId("paInviteHospital", "doctorPaHospital");
        const cnicInput = byId("paInviteCnic", "doctorPaCnic");
        const emailInput = byId("paInviteEmail", "doctorPaEmail");

        const selectedHospital = hospitalSelect ? hospitalSelect.value : "";
        const cnic = normalizeCnic(cnicInput ? cnicInput.value : "");
        const email = emailInput ? emailInput.value.trim().toLowerCase() : "";

        if (!selectedHospital) {
            setMessage("Select hospital for PA.", "error");
            return;
        }

        if (!/^[0-9]{13}$/.test(cnic)) {
            setMessage("PA CNIC must be exactly 13 digits.", "error");
            return;
        }

        if (!email) {
            setMessage("PA email is required.", "error");
            return;
        }

        try {
            setMessage("Creating PA invite/link...", "pending");

            const result = await apiRequest("/api/doctor/pa-invites", {
                method: "POST",
                headers: {
                    "Content-Type": "application/json"
                },
                body: JSON.stringify({
                    cnic,
                    invited_cnic: cnic,
                    email,
                    pa_email: email,
                    doctor_hospital_id: Number(selectedHospital)
                })
            });

            const form = byId("paInviteForm", "doctorPaInviteForm");

            if (form) {
                form.reset();
            }

            const latestInviteBox = byId("latestInviteBox");

            if (latestInviteBox) {
                const invite = result.data || result.invite || result || {};
                const token = invite.invite_token || result.invite_token;
                const link = buildPaInviteLink(token);

                latestInviteBox.classList.remove("hidden");

                latestInviteBox.innerHTML = link
                    ? `
                        <strong>Invite created.</strong>
                        ${renderClickableInviteLink(link)}
                      `
                    : `<strong>Invite/link created, but invite token was not returned.</strong>`;
            }

            await loadDoctorPaData();

            setMessage("PA invite/link created.", "ok");
        } catch (error) {
            setMessage(error.message, "error");
        }
    }

    function bindOnce(element, eventName, handler, key) {
        if (!element) {
            return;
        }

        const bindKey = `hmBound${key}`;

        if (element.dataset[bindKey] === "yes") {
            return;
        }

        element.dataset[bindKey] = "yes";
        element.addEventListener(eventName, handler, true);
    }

    function bindControls() {
        if (!isDoctor()) {
            return;
        }

        enforceScheduleTimePickers();

        allByIds("refreshDoctorSettingsButton", "refreshDoctorDashboardButton").forEach((button) => {
            bindOnce(button, "click", async (event) => {
                event.preventDefault();
                event.stopImmediatePropagation();
                await loadAllDoctorSettingsData();
            }, "RefreshDoctorSettings");
        });

        allByIds("refreshPaDataButton").forEach((button) => {
            bindOnce(button, "click", async (event) => {
                event.preventDefault();
                event.stopImmediatePropagation();
                await loadDoctorPaData();
            }, "RefreshDoctorPaData");
        });

        allByIds("hospitalForm", "doctorHospitalForm").forEach((form) => {
            bindOnce(form, "submit", addHospital, "HospitalForm");
        });

        allByIds("scheduleForm", "doctorScheduleForm").forEach((form) => {
            bindOnce(form, "submit", addSchedule, "ScheduleForm");
        });

        allByIds("formFieldForm", "doctorFieldForm").forEach((form) => {
            bindOnce(form, "submit", addField, "FieldForm");
        });

        allByIds("completeSettingsButton").forEach((button) => {
            bindOnce(button, "click", completeSettings, "CompleteSettings");
        });

        allByIds("paInviteForm", "doctorPaInviteForm").forEach((form) => {
            bindOnce(form, "submit", invitePa, "PaInviteForm");
        });

        allByIds("doctorSchedulesList").forEach((list) => {
            bindOnce(list, "click", deleteSchedule, "DeleteSchedule");
        });

        const paCnic = byId("paInviteCnic", "doctorPaCnic");

        if (paCnic && paCnic.dataset.hmNormalize !== "yes") {
            paCnic.dataset.hmNormalize = "yes";
            paCnic.addEventListener("input", () => {
                paCnic.value = normalizeCnic(paCnic.value);
            });
        }
    }

    document.addEventListener("click", (event) => {
        const inviteTarget = event.target.closest("[data-pa-invite-url]");

        if (!inviteTarget) {
            return;
        }

        event.preventDefault();
        event.stopPropagation();

        if (event.stopImmediatePropagation) {
            event.stopImmediatePropagation();
        }

        const url = inviteTarget.getAttribute("data-pa-invite-url");

        if (url) {
            window.open(url, "_blank", "noopener,noreferrer");
        }
    }, true);

    window.HM_LOAD_DOCTOR_SETTINGS = async function () {
        if (!shouldWorkNow()) {
            return;
        }

        bindControls();
        await loadAllDoctorSettingsData();
    };

    window.HM_LOAD_DOCTOR_PA_DATA = async function () {
        if (!shouldWorkNow()) {
            return;
        }

        bindControls();
        await loadDoctorPaData();
    };

    window.addEventListener("hm:tab-opened", async (event) => {
        const panelId = event.detail && event.detail.panelId;

        if (!shouldWorkNow()) {
            return;
        }

        bindControls();

        if (panelId === "doctorSettingsTab") {
            await loadDoctorSettings();
            return;
        }

        if (panelId === "doctorPaTab") {
            await loadDoctorPaData();
        }
    });

    document.addEventListener("click", async (event) => {
        const button = event.target.closest("button");

        if (!button || !shouldWorkNow()) {
            return;
        }

        if (button.id === "refreshDoctorSettingsButton" || button.id === "refreshDoctorDashboardButton") {
            event.preventDefault();
            await loadAllDoctorSettingsData();
            return;
        }

        if (button.id === "refreshPaDataButton") {
            event.preventDefault();
            await loadDoctorPaData();
        }
    });

    bindControls();
    enforceScheduleTimePickers();

    setTimeout(() => {
        if (initialDoctorLoadDone) {
            return;
        }

        initialDoctorLoadDone = true;

        if (shouldWorkNow()) {
            bindControls();
            enforceScheduleTimePickers();
            loadAllDoctorSettingsData();
        }
    }, 900);
});