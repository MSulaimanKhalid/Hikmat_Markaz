document.addEventListener("DOMContentLoaded", () => {
    const userRaw = localStorage.getItem("hm_user");

    if (!userRaw) {
        return;
    }

    const user = JSON.parse(userRaw);

    if (user.role !== "pa") {
        return;
    }

    const paDashboard = document.getElementById("paDashboard");

    if (!paDashboard) {
        return;
    }

    const tabContainer = paDashboard.querySelector(".doctor-module-tabs");

    if (!tabContainer) {
        return;
    }

    const isLocalFrontend =
        window.location.hostname === "127.0.0.1" ||
        window.location.hostname === "localhost" ||
        window.location.protocol === "file:";

    const API_BASE_URL = isLocalFrontend
        ? window.HM_CONFIG.LOCAL_API_URL
        : window.HM_CONFIG.PRODUCTION_API_URL;

    let selectedPrescriptionData = null;

    const prescriptionTabButton = document.createElement("button");
    prescriptionTabButton.className = "pa-module-tab";
    prescriptionTabButton.type = "button";
    prescriptionTabButton.setAttribute("data-pa-tab", "paPrescriptionsTab");
    prescriptionTabButton.textContent = "Prescriptions";

    tabContainer.appendChild(prescriptionTabButton);

    const prescriptionPanel = document.createElement("section");
    prescriptionPanel.id = "paPrescriptionsTab";
    prescriptionPanel.className = "pa-module-panel hidden";

    prescriptionPanel.innerHTML = `
        <div class="dashboard-header">
            <div>
                <h2>Prescription Center</h2>
                <p>Search patient by CNIC, view completed consultations, and print prescriptions.</p>
            </div>
        </div>

        <div id="prescriptionMessage" class="form-result"></div>

        <div class="prescription-layout">
            <div class="settings-card">
                <h3>Search Patient</h3>

                <form id="prescriptionSearchForm">
                    <label>Patient CNIC</label>
                    <input id="prescriptionPatientCnic" type="text" placeholder="3520212345671" required>

                    <button type="submit">Search Prescriptions</button>
                </form>

                <div id="prescriptionPatientBox" class="prescription-patient-box">
                    <p class="muted-text">No patient selected.</p>
                </div>
            </div>

            <div class="settings-list-card">
                <h3>Completed Visits</h3>

                <div id="prescriptionVisitsList" class="compact-list scroll-list tall-scroll-list">
                    <p class="muted-text">Search by CNIC to load completed visits.</p>
                </div>
            </div>

            <div class="settings-list-card prescription-preview-card">
                <h3>Prescription Preview</h3>

                <div id="prescriptionPreviewBox" class="prescription-preview-box">
                    <p class="muted-text">Select a completed visit to preview prescription.</p>
                </div>

                <button id="printPrescriptionButton" type="button">
                    Print Prescription
                </button>
            </div>
        </div>
    `;

    paDashboard.appendChild(prescriptionPanel);

    const prescriptionMessage = document.getElementById("prescriptionMessage");
    const prescriptionSearchForm = document.getElementById("prescriptionSearchForm");
    const prescriptionPatientCnic = document.getElementById("prescriptionPatientCnic");
    const prescriptionPatientBox = document.getElementById("prescriptionPatientBox");
    const prescriptionVisitsList = document.getElementById("prescriptionVisitsList");
    const prescriptionPreviewBox = document.getElementById("prescriptionPreviewBox");
    const printPrescriptionButton = document.getElementById("printPrescriptionButton");

    function showMessage(message, type) {
        prescriptionMessage.textContent = message;
        prescriptionMessage.classList.remove("ok", "error", "pending");

        if (type) {
            prescriptionMessage.classList.add(type);
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
            console.log("PRESCRIPTION_API_ERROR:", result);
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

    function formatDate(value) {
        if (!value) {
            return "N/A";
        }

        const date = new Date(value);

        return date.toLocaleDateString([], {
            year: "numeric",
            month: "short",
            day: "2-digit"
        });
    }

    function escapeHtml(value) {
        return String(value || "")
            .replaceAll("&", "&amp;")
            .replaceAll("<", "&lt;")
            .replaceAll(">", "&gt;")
            .replaceAll('"', "&quot;")
            .replaceAll("'", "&#039;");
    }

    function textToHtml(value) {
        return escapeHtml(value || "N/A").replaceAll("\n", "<br>");
    }

    function switchToPrescriptionTab() {
        paDashboard.querySelectorAll(".pa-module-tab").forEach((tab) => {
            tab.classList.remove("active");
        });

        paDashboard.querySelectorAll(".pa-module-panel").forEach((panel) => {
            panel.classList.add("hidden");
        });

        prescriptionTabButton.classList.add("active");
        prescriptionPanel.classList.remove("hidden");
    }

    function hidePrescriptionTabIfOtherTabClicked(event) {
        const clickedTab = event.target.closest(".pa-module-tab");

        if (!clickedTab) {
            return;
        }

        if (clickedTab.getAttribute("data-pa-tab") !== "paPrescriptionsTab") {
            prescriptionPanel.classList.add("hidden");
            prescriptionTabButton.classList.remove("active");
        }
    }

    async function searchPrescriptions(event) {
        event.preventDefault();

        const cnic = prescriptionPatientCnic.value.trim();

        if (!cnic) {
            showMessage("Patient CNIC is required.", "error");
            return;
        }

        try {
            selectedPrescriptionData = null;
            renderPrescriptionPreview(null);

            showMessage("Searching prescription history...", "pending");

            const result = await apiRequest(`/api/prescriptions/by-cnic?cnic=${encodeURIComponent(cnic)}`);

            const patient = result.data.patient;
            const visits = result.data.visits || [];

            renderPatientBox(patient);
            renderVisitsList(visits);

            if (!patient) {
                showMessage("Patient not found.", "error");
                return;
            }

            showMessage(`${visits.length} completed visit(s) found.`, "ok");
        } catch (error) {
            showMessage(error.message, "error");
        }
    }

    function renderPatientBox(patient) {
        if (!patient) {
            prescriptionPatientBox.innerHTML = `<p class="muted-text">No patient found.</p>`;
            return;
        }

        prescriptionPatientBox.innerHTML = `
            <div class="compact-item">
                <strong>${patient.name || "Unnamed Patient"}</strong>
                <span>CNIC: ${patient.cnic || "N/A"}</span>
                <span>Gender: ${patient.gender || "N/A"}</span>
                <span>DOB: ${patient.dob || "N/A"}</span>
                <span>Phone: ${patient.phone || "N/A"}</span>
                <span>Email: ${patient.email || "N/A"}</span>
            </div>
        `;
    }

    function renderVisitsList(visits) {
        if (!visits.length) {
            prescriptionVisitsList.innerHTML = `<p class="muted-text">No completed visits found for this patient.</p>`;
            return;
        }

        prescriptionVisitsList.innerHTML = visits.map((visit) => {
            return `
                <div class="prescription-visit-card" data-visit-id="${visit.visit_id}">
                    <strong>${formatDateTime(visit.appointment_datetime)}</strong>
                    <span>Doctor: ${visit.doctor_name} (${visit.specialization || "Doctor"})</span>
                    <span>Hospital: ${visit.hospital_name} - ${visit.hospital_city || ""}</span>
                    <span>Diagnosis: ${visit.diagnosis_text || "N/A"}</span>
                    <button type="button" class="secondary-button open-prescription-button">
                        Open Prescription
                    </button>
                </div>
            `;
        }).join("");
    }

    async function openPrescription(visitId) {
        try {
            showMessage("Loading prescription...", "pending");

            const result = await apiRequest(`/api/prescriptions/visits/${visitId}`);

            selectedPrescriptionData = result.data;

            renderPrescriptionPreview(result.data);

            showMessage("Prescription loaded.", "ok");
        } catch (error) {
            showMessage(error.message, "error");
        }
    }

    function renderPrescriptionPreview(data) {
        if (!data) {
            prescriptionPreviewBox.innerHTML = `<p class="muted-text">Select a completed visit to preview prescription.</p>`;
            return;
        }

        const p = data.prescription;
        const dynamicValues = data.dynamic_values || [];
        const printLogs = data.print_logs || [];

        prescriptionPreviewBox.innerHTML = `
            <div class="prescription-document">
                <div class="prescription-header">
                    <div>
                        <h2>Hikmat Markaz</h2>
                        <p>Digital Prescription</p>
                    </div>

                    <div>
                        <strong>${p.doctor_name}</strong>
                        <span>${p.specialization || "Doctor"}</span>
                        <span>License: ${p.license_number || "N/A"}</span>
                    </div>
                </div>

                <div class="prescription-section">
                    <h4>Patient Details</h4>
                    <div class="prescription-info-grid">
                        <span><strong>Name:</strong> ${p.patient_name || "N/A"}</span>
                        <span><strong>CNIC:</strong> ${p.patient_cnic || "N/A"}</span>
                        <span><strong>Gender:</strong> ${p.patient_gender || "N/A"}</span>
                        <span><strong>DOB:</strong> ${p.patient_dob || "N/A"}</span>
                        <span><strong>Phone:</strong> ${p.patient_phone || "N/A"}</span>
                        <span><strong>Date:</strong> ${formatDateTime(p.appointment_datetime)}</span>
                    </div>
                </div>

                <div class="prescription-section">
                    <h4>Hospital / Clinic</h4>
                    <p>${p.hospital_name || "N/A"} - ${p.hospital_city || ""}</p>
                    <p>${p.hospital_address || ""}</p>
                </div>

                <div class="prescription-section">
                    <h4>Vitals</h4>
                    <div class="prescription-info-grid">
                        <span><strong>BP:</strong> ${p.bp || "N/A"}</span>
                        <span><strong>Pulse:</strong> ${p.pulse || "N/A"}</span>
                        <span><strong>Temperature:</strong> ${p.temperature || "N/A"}</span>
                        <span><strong>Weight:</strong> ${p.weight || "N/A"}</span>
                    </div>
                </div>

                <div class="prescription-section">
                    <h4>Diagnosis</h4>
                    <p>${textToHtml(p.diagnosis_text)}</p>
                </div>

                <div class="prescription-section">
                    <h4>Treatment Plan / Prescription</h4>
                    <p>${textToHtml(p.treatment_plan)}</p>
                </div>

                <div class="prescription-section">
                    <h4>Follow-up Notes</h4>
                    <p>${textToHtml(p.follow_up_notes)}</p>
                </div>

                <div class="prescription-section">
                    <h4>Clinical Notes</h4>
                    <p>${textToHtml(p.clinical_notes)}</p>
                </div>

                ${
                    dynamicValues.length
                        ? `
                            <div class="prescription-section">
                                <h4>Additional Clinical Fields</h4>
                                ${dynamicValues.map((item) => {
                                    return `
                                        <p>
                                            <strong>${item.field_label || "Field"}:</strong>
                                            ${textToHtml(item.value_text)}
                                        </p>
                                    `;
                                }).join("")}
                            </div>
                        `
                        : ""
                }

                <div class="prescription-footer">
                    <p>Generated through Hikmat Markaz.</p>
                    <p>This print view is based on completed consultation data.</p>
                    ${
                        printLogs.length
                            ? `<p>Last printed: ${formatDateTime(printLogs[0].printed_at)}</p>`
                            : `<p>Not printed before.</p>`
                    }
                </div>
            </div>
        `;
    }

    function buildPrintableHtml(data) {
        const p = data.prescription;
        const dynamicValues = data.dynamic_values || [];

        return `
            <!DOCTYPE html>
            <html>
            <head>
                <title>Prescription - ${escapeHtml(p.patient_name || "Patient")}</title>
                <style>
                    body {
                        font-family: Arial, sans-serif;
                        color: #1f2b2a;
                        margin: 32px;
                        line-height: 1.5;
                    }

                    .header {
                        display: flex;
                        justify-content: space-between;
                        border-bottom: 2px solid #2f6d64;
                        padding-bottom: 16px;
                        margin-bottom: 22px;
                    }

                    h1, h2, h3 {
                        margin: 0;
                    }

                    .muted {
                        color: #667;
                        font-size: 13px;
                    }

                    .section {
                        margin-top: 18px;
                        border: 1px solid #ddd;
                        padding: 14px;
                        border-radius: 10px;
                    }

                    .grid {
                        display: grid;
                        grid-template-columns: 1fr 1fr;
                        gap: 8px 18px;
                    }

                    .footer {
                        margin-top: 36px;
                        border-top: 1px solid #ddd;
                        padding-top: 14px;
                        font-size: 12px;
                        color: #667;
                    }

                    @media print {
                        button {
                            display: none;
                        }
                    }
                </style>
            </head>
            <body>
                <div class="header">
                    <div>
                        <h1>Hikmat Markaz</h1>
                        <p class="muted">Digital Prescription</p>
                    </div>

                    <div>
                        <h3>${escapeHtml(p.doctor_name || "Doctor")}</h3>
                        <p>${escapeHtml(p.specialization || "Doctor")}</p>
                        <p class="muted">License: ${escapeHtml(p.license_number || "N/A")}</p>
                    </div>
                </div>

                <div class="section">
                    <h3>Patient Details</h3>
                    <div class="grid">
                        <p><strong>Name:</strong> ${escapeHtml(p.patient_name || "N/A")}</p>
                        <p><strong>CNIC:</strong> ${escapeHtml(p.patient_cnic || "N/A")}</p>
                        <p><strong>Gender:</strong> ${escapeHtml(p.patient_gender || "N/A")}</p>
                        <p><strong>DOB:</strong> ${escapeHtml(p.patient_dob || "N/A")}</p>
                        <p><strong>Phone:</strong> ${escapeHtml(p.patient_phone || "N/A")}</p>
                        <p><strong>Date:</strong> ${formatDateTime(p.appointment_datetime)}</p>
                    </div>
                </div>

                <div class="section">
                    <h3>Hospital / Clinic</h3>
                    <p>${escapeHtml(p.hospital_name || "N/A")} - ${escapeHtml(p.hospital_city || "")}</p>
                    <p>${escapeHtml(p.hospital_address || "")}</p>
                </div>

                <div class="section">
                    <h3>Vitals</h3>
                    <div class="grid">
                        <p><strong>BP:</strong> ${escapeHtml(p.bp || "N/A")}</p>
                        <p><strong>Pulse:</strong> ${escapeHtml(p.pulse || "N/A")}</p>
                        <p><strong>Temperature:</strong> ${escapeHtml(p.temperature || "N/A")}</p>
                        <p><strong>Weight:</strong> ${escapeHtml(p.weight || "N/A")}</p>
                    </div>
                </div>

                <div class="section">
                    <h3>Diagnosis</h3>
                    <p>${textToHtml(p.diagnosis_text)}</p>
                </div>

                <div class="section">
                    <h3>Treatment Plan / Prescription</h3>
                    <p>${textToHtml(p.treatment_plan)}</p>
                </div>

                <div class="section">
                    <h3>Follow-up Notes</h3>
                    <p>${textToHtml(p.follow_up_notes)}</p>
                </div>

                <div class="section">
                    <h3>Clinical Notes</h3>
                    <p>${textToHtml(p.clinical_notes)}</p>
                </div>

                ${
                    dynamicValues.length
                        ? `
                            <div class="section">
                                <h3>Additional Clinical Fields</h3>
                                ${dynamicValues.map((item) => {
                                    return `
                                        <p>
                                            <strong>${escapeHtml(item.field_label || "Field")}:</strong>
                                            ${textToHtml(item.value_text)}
                                        </p>
                                    `;
                                }).join("")}
                            </div>
                        `
                        : ""
                }

                <div class="footer">
                    <p>Generated through Hikmat Markaz.</p>
                    <p>This document is generated from completed consultation data.</p>
                </div>

                <script>
                    window.onload = function () {
                        window.print();
                    };
                </script>
            </body>
            </html>
        `;
    }

    async function printPrescription() {
        if (!selectedPrescriptionData) {
            showMessage("Select a prescription first.", "error");
            return;
        }

        const visitId = selectedPrescriptionData.prescription.visit_id;

        try {
            await apiRequest(`/api/prescriptions/visits/${visitId}/print-log`, {
                method: "POST"
            });
        } catch (error) {
            console.log("Print log failed:", error.message);
        }

        const printWindow = window.open("", "_blank");

        if (!printWindow) {
            showMessage("Popup blocked. Allow popups to print prescription.", "error");
            return;
        }

        printWindow.document.open();
        printWindow.document.write(buildPrintableHtml(selectedPrescriptionData));
        printWindow.document.close();

        showMessage("Prescription print window opened.", "ok");
    }

    function handleVisitClick(event) {
        const button = event.target.closest(".open-prescription-button");

        if (!button) {
            return;
        }

        const card = event.target.closest(".prescription-visit-card");

        if (!card) {
            return;
        }

        const visitId = card.getAttribute("data-visit-id");

        if (!visitId) {
            showMessage("Visit ID not found.", "error");
            return;
        }

        openPrescription(visitId);
    }

    prescriptionTabButton.addEventListener("click", switchToPrescriptionTab);
    tabContainer.addEventListener("click", hidePrescriptionTabIfOtherTabClicked);
    prescriptionSearchForm.addEventListener("submit", searchPrescriptions);
    prescriptionVisitsList.addEventListener("click", handleVisitClick);
    printPrescriptionButton.addEventListener("click", printPrescription);
});