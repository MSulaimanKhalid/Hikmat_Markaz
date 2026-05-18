document.addEventListener("DOMContentLoaded", () => {
    const userRaw = localStorage.getItem("hm_user");

    if (!userRaw) {
        return;
    }

    const user = JSON.parse(userRaw);

    if (user.role !== "patient") {
        return;
    }

    const patientDashboard = document.getElementById("patientDashboard");

    if (!patientDashboard) {
        return;
    }

    const isLocalFrontend =
        window.location.hostname === "127.0.0.1" ||
        window.location.hostname === "localhost" ||
        window.location.protocol === "file:";

    const API_BASE_URL = window.HM_CONFIG
        ? (
            isLocalFrontend
                ? window.HM_CONFIG.LOCAL_API_URL
                : window.HM_CONFIG.PRODUCTION_API_URL
        )
        : "http://127.0.0.1:5000";

    let selectedSlot = null;

    patientDashboard.innerHTML = `
        <div class="dashboard-header">
            <div>
                <h2>Patient Portal</h2>
                <p>View your appointments, prescriptions, and request new appointments.</p>
            </div>

            <button id="refreshPatientPortalButton" class="secondary-button" type="button">
                Refresh
            </button>
        </div>

        <div class="doctor-module-tabs">
            <button class="patient-module-tab active" type="button" data-patient-tab="patientAppointmentsTab">
                My Appointments
            </button>

            <button class="patient-module-tab" type="button" data-patient-tab="patientPrescriptionsTab">
                My Prescriptions
            </button>

            <button class="patient-module-tab" type="button" data-patient-tab="patientRequestAppointmentTab">
                Request Appointment
            </button>
        </div>

        <div id="patientPortalMessage" class="form-result"></div>

        <section id="patientAppointmentsTab" class="patient-module-panel">
            <div class="patient-grid">
                <div class="settings-list-card">
                    <h3>Confirmed Appointments</h3>
                    <div id="patientAppointmentsList" class="compact-list scroll-list tall-scroll-list">
                        <p class="muted-text">No appointments loaded.</p>
                    </div>
                </div>

                <div class="settings-list-card">
                    <h3>Online Requests</h3>
                    <div id="patientRequestsList" class="compact-list scroll-list tall-scroll-list">
                        <p class="muted-text">No requests loaded.</p>
                    </div>
                </div>
            </div>
        </section>

        <section id="patientPrescriptionsTab" class="patient-module-panel hidden">
            <div id="patientPrescriptionsList" class="compact-list scroll-list tall-scroll-list">
                <p class="muted-text">No prescriptions loaded.</p>
            </div>
        </section>

        <section id="patientRequestAppointmentTab" class="patient-module-panel hidden">
            <div class="patient-request-grid">
                <div class="settings-card">
                    <h3>Select Doctor</h3>

                    <label>Doctor / Hospital</label>
                    <select id="patientDoctorSelect">
                        <option value="">Loading doctors...</option>
                    </select>

                    <label>Notes for PA</label>
                    <textarea id="patientRequestNotes" placeholder="Briefly describe your concern or preferred note"></textarea>

                    <button id="loadPatientSlotsButton" type="button">
                        Load Available Slots
                    </button>
                </div>

                <div class="settings-list-card">
                    <h3>Available Slots</h3>
                    <div id="patientSlotsList" class="compact-list scroll-list tall-scroll-list">
                        <p class="muted-text">Select doctor and load slots.</p>
                    </div>
                </div>

                <div class="settings-card">
                    <h3>Selected Slot</h3>
                    <div id="patientSelectedSlotBox">
                        <p class="muted-text">No slot selected.</p>
                    </div>

                    <button id="submitPatientRequestButton" type="button">
                        Submit Appointment Request
                    </button>
                </div>
            </div>
        </section>
    `;

    const messageBox = document.getElementById("patientPortalMessage");
    const refreshButton = document.getElementById("refreshPatientPortalButton");
    const tabButtons = document.querySelectorAll(".patient-module-tab");
    const tabPanels = document.querySelectorAll(".patient-module-panel");

    const appointmentsList = document.getElementById("patientAppointmentsList");
    const requestsList = document.getElementById("patientRequestsList");
    const prescriptionsList = document.getElementById("patientPrescriptionsList");

    const doctorSelect = document.getElementById("patientDoctorSelect");
    const requestNotes = document.getElementById("patientRequestNotes");
    const loadSlotsButton = document.getElementById("loadPatientSlotsButton");
    const slotsList = document.getElementById("patientSlotsList");
    const selectedSlotBox = document.getElementById("patientSelectedSlotBox");
    const submitRequestButton = document.getElementById("submitPatientRequestButton");

    function showMessage(message, type) {
        messageBox.textContent = message;
        messageBox.classList.remove("ok", "error", "pending");

        if (type) {
            messageBox.classList.add(type);
        }
    }

    async function apiRequest(path, options = {}) {
        const token = localStorage.getItem("hm_token");

        if (!token) {
            window.location.href = "./index.html";
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
            console.log("PATIENT_PORTAL_API_ERROR:", result);
            throw new Error(result.error || result.message || "Request failed.");
        }

        return result;
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

    function safeHtml(value) {
        return String(value || "")
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;");
    }

    function switchTab(tabId) {
        tabButtons.forEach((button) => {
            button.classList.remove("active");

            if (button.getAttribute("data-patient-tab") === tabId) {
                button.classList.add("active");
            }
        });

        tabPanels.forEach((panel) => {
            panel.classList.add("hidden");

            if (panel.id === tabId) {
                panel.classList.remove("hidden");
            }
        });

        if (tabId === "patientPrescriptionsTab") {
            loadPatientPrescriptions();
        }

        if (tabId === "patientRequestAppointmentTab") {
            loadPatientDoctors();
        }
    }

    async function loadPatientPortal() {
        try {
            showMessage("Loading patient portal...", "pending");

            await loadPatientAppointments();
            await loadPatientPrescriptions();
            await loadPatientDoctors();

            showMessage("Patient portal loaded.", "ok");
        } catch (error) {
            showMessage(error.message, "error");
        }
    }

    async function loadPatientAppointments() {
        const result = await apiRequest("/api/patient/appointments");

        renderAppointments(result.data.appointments || []);
        renderRequests(result.data.requests || []);
    }

    function renderAppointments(appointments) {
        if (!appointments.length) {
            appointmentsList.innerHTML = `<p class="muted-text">No confirmed appointments found.</p>`;
            return;
        }

        appointmentsList.innerHTML = appointments.map((appointment) => {
            return `
                <div class="compact-item">
                    <strong>${formatDateTime(appointment.appointment_datetime)}</strong>
                    <span>Doctor: ${appointment.doctor_name} (${appointment.specialization || "Doctor"})</span>
                    <span>Hospital: ${appointment.hospital_name} - ${appointment.hospital_city || ""}</span>
                    <span>Fee: ${appointment.fee_charged} (${appointment.fee_status})</span>
                    <span>Status: ${appointment.status}</span>
                    <span>Source: ${appointment.source}</span>
                </div>
            `;
        }).join("");
    }

    function renderRequests(requests) {
        if (!requests.length) {
            requestsList.innerHTML = `<p class="muted-text">No online appointment requests found.</p>`;
            return;
        }

        requestsList.innerHTML = requests.map((request) => {
            return `
                <div class="compact-item">
                    <strong>${formatDateTime(request.requested_datetime)}</strong>
                    <span>Doctor: ${request.doctor_name} (${request.specialization || "Doctor"})</span>
                    <span>Hospital: ${request.hospital_name} - ${request.hospital_city || ""}</span>
                    <span>Expected Fee: ${request.expected_fee}</span>
                    <span>Status: ${request.status}</span>
                    ${request.rejection_reason ? `<span>Reason: ${request.rejection_reason}</span>` : ""}
                    ${request.patient_notes ? `<span>Your Notes: ${request.patient_notes}</span>` : ""}
                </div>
            `;
        }).join("");
    }

    async function loadPatientPrescriptions() {
        const result = await apiRequest("/api/patient/prescriptions");
        const prescriptions = result.data || [];

        if (!prescriptions.length) {
            prescriptionsList.innerHTML = `<p class="muted-text">No completed prescriptions found.</p>`;
            return;
        }

        prescriptionsList.innerHTML = prescriptions.map((item) => {
            return `
                <div class="compact-item" data-visit-id="${item.visit_id}">
                    <strong>${formatDateTime(item.appointment_datetime)}</strong>
                    <span>Doctor: ${item.doctor_name} (${item.specialization || "Doctor"})</span>
                    <span>Hospital: ${item.hospital_name} - ${item.hospital_city || ""}</span>
                    <span>Diagnosis: ${item.diagnosis_text || "N/A"}</span>
                    <span>Treatment: ${item.treatment_plan || "N/A"}</span>
                    <span>Follow-up: ${item.follow_up_notes || "N/A"}</span>

                    <button
                        type="button"
                        class="secondary-button"
                        data-action="view-prescription-print"
                        data-visit-id="${item.visit_id}"
                    >
                        View Print Format
                    </button>
                </div>
            `;
        }).join("");
    }

    function buildPrescriptionPrintHtml(data) {
        const prescription = data.prescription || {};
        const fields = data.dynamic_fields || [];

        const visitDate =
            prescription.completed_at ||
            prescription.started_at ||
            prescription.scheduled_start ||
            prescription.appointment_datetime ||
            "";

        const formattedDate = visitDate
            ? new Date(visitDate).toLocaleString()
            : "N/A";

        const fieldRows = fields.length
            ? fields.map((field) => `
                <tr>
                    <td>${safeHtml(field.field_label_snapshot || "Field")}</td>
                    <td>${safeHtml(field.value_text || "")}</td>
                </tr>
            `).join("")
            : `
                <tr>
                    <td colspan="2">No additional clinical fields recorded.</td>
                </tr>
            `;

        return `
            <!doctype html>
            <html>
            <head>
                <title>Prescription</title>
                <style>
                    body {
                        font-family: Arial, sans-serif;
                        background: #ffffff;
                        color: #111111;
                        margin: 0;
                        padding: 24px;
                    }

                    .actions {
                        max-width: 850px;
                        margin: 0 auto 16px auto;
                        text-align: right;
                    }

                    button {
                        padding: 10px 16px;
                        border: none;
                        background: #111111;
                        color: #ffffff;
                        cursor: pointer;
                        border-radius: 6px;
                    }

                    .prescription-document {
                        max-width: 850px;
                        margin: 0 auto;
                        border: 1px solid #222222;
                        padding: 24px;
                    }

                    .prescription-header {
                        display: flex;
                        justify-content: space-between;
                        gap: 24px;
                        border-bottom: 2px solid #222222;
                        padding-bottom: 12px;
                        margin-bottom: 16px;
                    }

                    .prescription-header h1 {
                        margin: 0;
                        font-size: 26px;
                    }

                    .section {
                        margin-top: 18px;
                    }

                    .section h3 {
                        border-bottom: 1px solid #999999;
                        padding-bottom: 6px;
                        margin-bottom: 8px;
                    }

                    table {
                        width: 100%;
                        border-collapse: collapse;
                        margin-top: 8px;
                    }

                    td,
                    th {
                        border: 1px solid #999999;
                        padding: 8px;
                        text-align: left;
                        vertical-align: top;
                    }

                    .footer {
                        margin-top: 36px;
                        display: flex;
                        justify-content: space-between;
                        align-items: flex-end;
                    }

                    .signature {
                        width: 240px;
                        border-top: 1px solid #111111;
                        text-align: center;
                        padding-top: 8px;
                    }

                    @media print {
                        .actions {
                            display: none;
                        }

                        body {
                            padding: 0;
                        }

                        .prescription-document {
                            border: none;
                        }
                    }
                </style>
            </head>

            <body>
                <div class="actions">
                    <button onclick="window.print()">Print Prescription</button>
                </div>

                <div class="prescription-document">
                    <div class="prescription-header">
                        <div>
                            <h1>Hikmat Markaz</h1>
                            <p>${safeHtml(prescription.hospital_name || "Clinic / Hospital")}</p>
                            <p>${safeHtml(prescription.hospital_address || "")}${prescription.hospital_city ? ", " + safeHtml(prescription.hospital_city) : ""}</p>
                        </div>

                        <div>
                            <strong>Prescription</strong>
                            <p>Date: ${safeHtml(formattedDate)}</p>
                        </div>
                    </div>

                    <div class="section">
                        <h3>Doctor</h3>
                        <p><strong>${safeHtml(prescription.doctor_name || "N/A")}</strong></p>
                        <p>${safeHtml(prescription.doctor_specialization || "")}</p>
                        <p>License: ${safeHtml(prescription.doctor_license_number || "N/A")}</p>
                    </div>

                    <div class="section">
                        <h3>Patient</h3>
                        <table>
                            <tr>
                                <td><strong>Name</strong></td>
                                <td>${safeHtml(prescription.patient_name || "N/A")}</td>
                            </tr>
                            <tr>
                                <td><strong>CNIC</strong></td>
                                <td>${safeHtml(prescription.patient_cnic || "N/A")}</td>
                            </tr>
                            <tr>
                                <td><strong>Gender</strong></td>
                                <td>${safeHtml(prescription.patient_gender || "N/A")}</td>
                            </tr>
                            <tr>
                                <td><strong>Phone</strong></td>
                                <td>${safeHtml(prescription.patient_phone || "N/A")}</td>
                            </tr>
                        </table>
                    </div>

                    <div class="section">
                        <h3>Vitals / Clinical Fields</h3>
                        <table>
                            <tr>
                                <td><strong>BP</strong></td>
                                <td>${safeHtml(prescription.bp || "N/A")}</td>
                            </tr>
                            <tr>
                                <td><strong>Pulse</strong></td>
                                <td>${safeHtml(prescription.pulse || "N/A")}</td>
                            </tr>
                            <tr>
                                <td><strong>Temperature</strong></td>
                                <td>${safeHtml(prescription.temperature || "N/A")}</td>
                            </tr>
                            <tr>
                                <td><strong>Weight</strong></td>
                                <td>${safeHtml(prescription.weight || "N/A")}</td>
                            </tr>
                            ${fieldRows}
                        </table>
                    </div>

                    <div class="section">
                        <h3>Diagnosis</h3>
                        <p>${safeHtml(prescription.diagnosis_text || "N/A")}</p>
                    </div>

                    <div class="section">
                        <h3>Treatment Plan / Prescription</h3>
                        <p>${safeHtml(prescription.treatment_plan || "N/A")}</p>
                    </div>

                    <div class="section">
                        <h3>Follow-up Notes</h3>
                        <p>${safeHtml(prescription.follow_up_notes || "N/A")}</p>
                    </div>

                    <div class="footer">
                        <div>
                            <p>Generated by Hikmat Markaz</p>
                        </div>

                        <div class="signature">
                            Doctor Signature
                        </div>
                    </div>
                </div>
            </body>
            </html>
        `;
    }

    async function openPrescriptionPrintFormat(visitId) {
    if (!visitId) {
        showMessage("Visit ID missing for this prescription.", "error");
        return;
    }

    const printWindow = window.open("", "_blank");

    if (!printWindow) {
        showMessage("Popup blocked. Please allow popups for this site.", "error");
        return;
    }

    printWindow.document.open();
    printWindow.document.write(`
        <!doctype html>
        <html>
        <head>
            <title>Loading Prescription</title>
            <style>
                body {
                    font-family: Arial, sans-serif;
                    padding: 24px;
                }
            </style>
        </head>
        <body>
            <p>Loading prescription...</p>
        </body>
        </html>
    `);
    printWindow.document.close();

    try {
        showMessage("Opening prescription print format...", "pending");

        const result = await apiRequest(`/api/patient/prescriptions/visits/${visitId}/print`);
        const html = buildPrescriptionPrintHtml(result.data || {});

        printWindow.document.open();
        printWindow.document.write(html);
        printWindow.document.close();

        showMessage("Prescription print format opened.", "ok");
    } catch (error) {
        printWindow.document.open();
        printWindow.document.write(`
            <!doctype html>
            <html>
            <head>
                <title>Prescription Error</title>
                <style>
                    body {
                        font-family: Arial, sans-serif;
                        padding: 24px;
                        color: #111;
                    }

                    .error {
                        border: 1px solid #cc0000;
                        padding: 16px;
                        border-radius: 8px;
                    }
                </style>
            </head>
            <body>
                <div class="error">
                    <h2>Could not load prescription</h2>
                    <p>${safeHtml(error.message)}</p>
                </div>
            </body>
            </html>
        `);
        printWindow.document.close();

        showMessage(error.message, "error");
    }
}

    async function loadPatientDoctors() {
        const result = await apiRequest("/api/patient/doctors");
        const doctors = result.data || [];

        if (!doctors.length) {
            doctorSelect.innerHTML = `<option value="">No doctors available</option>`;
            return;
        }

        doctorSelect.innerHTML = `<option value="">Select doctor / hospital</option>` + doctors.map((doctor) => {
            return `
                <option value="${doctor.doctor_hospital_id}">
                    ${doctor.doctor_name} - ${doctor.specialization || "Doctor"} - ${doctor.hospital_name} (${doctor.hospital_city || ""})
                </option>
            `;
        }).join("");
    }

    async function loadPatientSlots() {
        const doctorHospitalId = doctorSelect.value;

        if (!doctorHospitalId) {
            showMessage("Select a doctor/hospital first.", "error");
            return;
        }

        try {
            selectedSlot = null;
            renderSelectedSlot();

            showMessage("Loading available slots...", "pending");

            const result = await apiRequest(`/api/patient/available-slots?doctor_hospital_id=${doctorHospitalId}&days=14`);

            renderSlots(result.data || []);

            showMessage(`${(result.data || []).length} available slot(s) loaded.`, "ok");
        } catch (error) {
            showMessage(error.message, "error");
        }
    }

    function renderSlots(slots) {
        if (!slots.length) {
            slotsList.innerHTML = `<p class="muted-text">No available slots found.</p>`;
            slotsList.dataset.slots = "[]";
            return;
        }

        slotsList.dataset.slots = JSON.stringify(slots);

        slotsList.innerHTML = slots.map((slot, index) => {
            return `
                <button type="button" class="slot-button" data-slot-index="${index}">
                    <strong>${slot.date}</strong>
                    <span>${slot.start_time} - ${slot.end_time}</span>
                    <span>${slot.doctor_name} (${slot.specialization || "Doctor"})</span>
                    <span>${slot.hospital_name} - ${slot.hospital_city || ""}</span>
                    <span>Expected Fee: ${slot.expected_fee}</span>
                </button>
            `;
        }).join("");
    }

    function selectSlot(index) {
        const slots = JSON.parse(slotsList.dataset.slots || "[]");
        selectedSlot = slots[index];

        document.querySelectorAll("#patientSlotsList .slot-button").forEach((button) => {
            button.classList.remove("selected");
        });

        const selectedButton = slotsList.querySelector(`[data-slot-index="${index}"]`);

        if (selectedButton) {
            selectedButton.classList.add("selected");
        }

        renderSelectedSlot();
    }

    function renderSelectedSlot() {
        if (!selectedSlot) {
            selectedSlotBox.innerHTML = `<p class="muted-text">No slot selected.</p>`;
            return;
        }

        selectedSlotBox.innerHTML = `
            <div class="compact-item">
                <strong>${selectedSlot.date}</strong>
                <span>${selectedSlot.start_time} - ${selectedSlot.end_time}</span>
                <span>Doctor: ${selectedSlot.doctor_name}</span>
                <span>Hospital: ${selectedSlot.hospital_name}</span>
                <span>Expected Fee: ${selectedSlot.expected_fee}</span>
            </div>
        `;
    }

    async function submitAppointmentRequest() {
        if (!selectedSlot) {
            showMessage("Select a slot first.", "error");
            return;
        }

        try {
            showMessage("Submitting appointment request...", "pending");

            const payload = {
                doctor_hospital_id: selectedSlot.doctor_hospital_id,
                appointment_datetime: selectedSlot.appointment_datetime,
                patient_notes: requestNotes.value.trim()
            };

            const result = await apiRequest("/api/patient/appointment-requests", {
                method: "POST",
                headers: {
                    "Content-Type": "application/json"
                },
                body: JSON.stringify(payload)
            });

            showMessage(result.message, "ok");

            selectedSlot = null;
            renderSelectedSlot();
            slotsList.innerHTML = `<p class="muted-text">Request submitted. Load slots again for latest availability.</p>`;
            requestNotes.value = "";

            await loadPatientAppointments();
        } catch (error) {
            showMessage(error.message, "error");
        }
    }

    tabButtons.forEach((button) => {
        button.addEventListener("click", () => {
            switchTab(button.getAttribute("data-patient-tab"));
        });
    });

    refreshButton.addEventListener("click", loadPatientPortal);
    loadSlotsButton.addEventListener("click", loadPatientSlots);
    submitRequestButton.addEventListener("click", submitAppointmentRequest);

    slotsList.addEventListener("click", (event) => {
        const button = event.target.closest(".slot-button");

        if (!button) {
            return;
        }

        selectSlot(Number(button.getAttribute("data-slot-index")));
    });

    prescriptionsList.addEventListener("click", (event) => {
        const button = event.target.closest("[data-action='view-prescription-print']");

        if (!button) {
            return;
        }

        const visitId = button.getAttribute("data-visit-id");
        openPrescriptionPrintFormat(visitId);
    });

    window.HM_LOAD_PATIENT_PORTAL = loadPatientPortal;
    window.HM_LOAD_PATIENT_PRESCRIPTIONS = loadPatientPrescriptions;

    loadPatientPortal();
});