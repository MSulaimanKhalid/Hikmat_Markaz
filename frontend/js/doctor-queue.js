document.addEventListener("DOMContentLoaded", () => {
    const userRaw = localStorage.getItem("hm_user");

    if (!userRaw) {
        return;
    }

    const user = JSON.parse(userRaw);

    if (user.role !== "doctor") {
        return;
    }

    const queueTab = document.getElementById("doctorQueueTab");

    if (!queueTab) {
        return;
    }

    const isLocalFrontend =
        window.location.hostname === "127.0.0.1" ||
        window.location.hostname === "localhost" ||
        window.location.protocol === "file:";

    const API_BASE_URL = isLocalFrontend
        ? window.HM_CONFIG.LOCAL_API_URL
        : window.HM_CONFIG.PRODUCTION_API_URL;

    let activeAppointmentId = null;
    let activeConsultationData = null;

    queueTab.innerHTML = `
        <div class="dashboard-header">
            <div>
                <h2>Doctor Queue</h2>
                <p>View waiting patients, prioritize emergency cases, and complete consultations.</p>
            </div>

            <button id="refreshDoctorQueueButton" class="secondary-button" type="button">
                Refresh Queue
            </button>
        </div>

        <div id="doctorQueueMessage" class="form-result"></div>

        <div class="queue-filter-grid">
            <div>
                <label>Date</label>
                <input id="doctorQueueDate" type="date">
            </div>

            <div>
                <label>Hospital / Clinic</label>
                <select id="doctorQueueHospital">
                    <option value="">All hospitals</option>
                </select>
            </div>

            <div>
                <label>PA</label>
                <select id="doctorQueuePa">
                    <option value="">All PAs</option>
                </select>
            </div>

            <div>
                <label>Status</label>
                <select id="doctorQueueStatus">
                    <option value="active">Active Queue</option>
                    <option value="pending_fee">Pending Fee</option>
                    <option value="waiting">Waiting</option>
                    <option value="in_consultation">In Consultation</option>
                    <option value="completed">Completed</option>
                    <option value="all">All</option>
                </select>
            </div>
        </div>

        <div class="doctor-queue-layout">
            <div class="settings-list-card">
                <h3>Queue</h3>
                <div id="doctorQueueList" class="compact-list scroll-list tall-scroll-list">
                    <p class="muted-text">No queue loaded.</p>
                </div>
            </div>

            <div class="settings-list-card consultation-panel-card">
                <h3>Consultation Panel</h3>
                <div id="doctorConsultationPanel">
                    <p class="muted-text">Start or open a consultation to view details.</p>
                </div>
            </div>
        </div>
    `;

    const doctorQueueMessage = document.getElementById("doctorQueueMessage");
    const doctorQueueDate = document.getElementById("doctorQueueDate");
    const doctorQueueHospital = document.getElementById("doctorQueueHospital");
    const doctorQueuePa = document.getElementById("doctorQueuePa");
    const doctorQueueStatus = document.getElementById("doctorQueueStatus");
    const refreshDoctorQueueButton = document.getElementById("refreshDoctorQueueButton");
    const doctorQueueList = document.getElementById("doctorQueueList");
    const doctorConsultationPanel = document.getElementById("doctorConsultationPanel");

    function todayIsoDate() {
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, "0");
    const day = String(now.getDate()).padStart(2, "0");

    return `${year}-${month}-${day}`;
}

    function showMessage(message, type) {
        doctorQueueMessage.textContent = message;
        doctorQueueMessage.classList.remove("ok", "error", "pending");

        if (type) {
            doctorQueueMessage.classList.add(type);
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
            console.log("DOCTOR_QUEUE_API_ERROR:", result);
            throw new Error(result.error || result.message || "Request failed.");
        }

        return result;
    }

    function formatDateTime(value) {
        if (!value) {
            return "";
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

    function statusLabel(status) {
        const map = {
            pending_fee: "Pending Fee",
            waiting: "Waiting",
            in_consultation: "In Consultation",
            completed: "Completed",
            cancelled: "Cancelled",
            no_show: "No Show"
        };

        return map[status] || status;
    }

    async function loadQueueFilters() {
        const result = await apiRequest("/api/doctor/queue/filters");

        const hospitals = result.data.hospitals || [];
        const pas = result.data.pas || [];

        doctorQueueHospital.innerHTML =
            `<option value="">All hospitals</option>` +
            hospitals.map((hospital) => {
                return `
                    <option value="${hospital.id}">
                        ${hospital.name} - ${hospital.city || ""}
                    </option>
                `;
            }).join("");

        doctorQueuePa.innerHTML =
            `<option value="">All PAs</option>` +
            pas.map((pa) => {
                return `
                    <option value="${pa.pa_id}">
                        ${pa.full_name || pa.email || "Unnamed PA"} - ${pa.hospital_name}
                    </option>
                `;
            }).join("");
    }

    async function loadDoctorQueue() {
        try {
            if (!doctorQueueDate.value) {
                doctorQueueDate.value = todayIsoDate();
            }

            showMessage("Loading doctor queue...", "pending");

            const params = new URLSearchParams();
            params.set("date", doctorQueueDate.value);
            params.set("status", doctorQueueStatus.value || "active");

            if (doctorQueueHospital.value) {
                params.set("doctor_hospital_id", doctorQueueHospital.value);
            }

            if (doctorQueuePa.value) {
                params.set("pa_id", doctorQueuePa.value);
            }

            const result = await apiRequest(`/api/doctor/queue?${params.toString()}`);

            renderQueue(result.data || []);

            showMessage(`${(result.data || []).length} queue item(s) loaded.`, "ok");
        } catch (error) {
            showMessage(error.message, "error");
        }
    }

    function renderQueue(appointments) {
        if (!appointments.length) {
            doctorQueueList.innerHTML = `<p class="muted-text">No appointments found.</p>`;
            return;
        }

        doctorQueueList.innerHTML = appointments.map((appointment) => {
            const canMarkPaid = appointment.fee_status === "pending";
            const canStart = appointment.status === "waiting";
            const canOpen = appointment.status === "in_consultation";
            const isCompleted = appointment.status === "completed";

            return `
                <div class="queue-appointment-card" data-appointment-id="${appointment.appointment_id}">
                    <div class="queue-card-top">
                        <div>
                            <strong>${appointment.patient_name}</strong>
                            <span>${formatDateTime(appointment.appointment_datetime)}</span>
                        </div>

                        <span class="queue-status-pill ${appointment.status}">
                            ${statusLabel(appointment.status)}
                        </span>
                    </div>

                    <div class="queue-card-meta">
                        <span>CNIC: ${appointment.patient_cnic}</span>
                        <span>Phone: ${appointment.patient_phone || "No phone"}</span>
                        <span>Hospital: ${appointment.hospital_name} - ${appointment.hospital_city || ""}</span>
                        <span>PA: ${appointment.pa_name || appointment.pa_email || "N/A"}</span>
                        <span>Fee: ${appointment.fee_charged} (${appointment.fee_status})</span>
                        <span>Priority: ${appointment.priority_level || 0}</span>
                        ${appointment.priority_reason ? `<span>Reason: ${appointment.priority_reason}</span>` : ""}
                    </div>

                    <div class="queue-card-actions">
                        ${canMarkPaid ? `
                            <button type="button" data-action="mark-paid">
                                Mark Paid
                            </button>
                        ` : ""}

                        ${!isCompleted ? `
                            <button type="button" class="secondary-button" data-action="prioritize">
                                Prioritize
                            </button>
                        ` : ""}

                        ${canStart ? `
                            <button type="button" data-action="start">
                                Start Consultation
                            </button>
                        ` : ""}

                        ${canOpen ? `
                            <button type="button" data-action="open">
                                Open Consultation
                            </button>
                        ` : ""}

                        ${isCompleted ? `
                            <button type="button" class="secondary-button" data-action="open">
                                View Completed
                            </button>
                        ` : ""}
                    </div>
                </div>
            `;
        }).join("");
    }

    async function markPaid(appointmentId) {
        try {
            showMessage("Marking fee as paid...", "pending");

            const result = await apiRequest(`/api/doctor/appointments/${appointmentId}/mark-paid`, {
                method: "POST"
            });

            showMessage(result.message, "ok");
            await loadDoctorQueue();
        } catch (error) {
            showMessage(error.message, "error");
        }
    }

    async function prioritizeAppointment(appointmentId) {
        const levelInput = window.prompt("Enter priority level from 1 to 10", "5");

        if (levelInput === null) {
            return;
        }

        const reason = window.prompt("Reason for priority", "Emergency case") || "";

        try {
            showMessage("Updating priority...", "pending");

            const result = await apiRequest(`/api/doctor/appointments/${appointmentId}/prioritize`, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json"
                },
                body: JSON.stringify({
                    priority_level: Number(levelInput),
                    priority_reason: reason
                })
            });

            showMessage(result.message, "ok");
            await loadDoctorQueue();
        } catch (error) {
            showMessage(error.message, "error");
        }
    }

    async function startConsultation(appointmentId) {
        try {
            showMessage("Starting consultation...", "pending");

            const result = await apiRequest(`/api/doctor/appointments/${appointmentId}/start`, {
                method: "POST"
            });

            showMessage(result.message, "ok");
            await loadDoctorQueue();
            await openConsultation(appointmentId);
        } catch (error) {
            showMessage(error.message, "error");
        }
    }

    async function openConsultation(appointmentId) {
        try {
            activeAppointmentId = appointmentId;

            showMessage("Loading consultation details...", "pending");

            const result = await apiRequest(`/api/doctor/appointments/${appointmentId}/consultation`);

            activeConsultationData = result.data;

            renderConsultationPanel(result.data);

            showMessage("Consultation details loaded.", "ok");
        } catch (error) {
            showMessage(error.message, "error");
        }
    }

    function renderConsultationPanel(data) {
        const appointment = data.appointment;
        const visit = data.visit || {};
        const dynamicFields = data.dynamic_fields || [];
        const previousHistory = data.previous_history || [];

        const completed = appointment.status === "completed";

        doctorConsultationPanel.innerHTML = `
            <div class="consultation-summary">
                <strong>${appointment.patient_name}</strong>
                <span>CNIC: ${appointment.patient_cnic}</span>
                <span>Gender: ${appointment.patient_gender || "N/A"}</span>
                <span>Phone: ${appointment.patient_phone || "N/A"}</span>
                <span>Hospital: ${appointment.hospital_name}</span>
                <span>Status: ${statusLabel(appointment.status)}</span>
            </div>

            <div class="previous-history-box">
                <h4>Previous Hikmat Markaz History</h4>
                ${
                    previousHistory.length
                        ? previousHistory.map((item) => {
                            return `
                                <div class="history-item">
                                    <strong>${formatDateTime(item.appointment_datetime)}</strong>
                                    <span>Doctor: ${item.doctor_name} (${item.specialization || "Doctor"})</span>
                                    <span>Diagnosis: ${item.diagnosis_text || "N/A"}</span>
                                    <span>Treatment: ${item.treatment_plan || "N/A"}</span>
                                </div>
                            `;
                        }).join("")
                        : `<p class="muted-text">No previous completed visits found.</p>`
                }
            </div>

            <form id="doctorConsultationForm" class="consultation-form">
                <h4>Vitals</h4>

                <div class="consultation-field-grid">
                    <div>
                        <label>BP</label>
                        <input id="consultationBp" type="text" value="${visit.bp || ""}" placeholder="120/80">
                    </div>

                    <div>
                        <label>Pulse</label>
                        <input id="consultationPulse" type="text" value="${visit.pulse || ""}" placeholder="80">
                    </div>

                    <div>
                        <label>Temperature</label>
                        <input id="consultationTemperature" type="text" value="${visit.temperature || ""}" placeholder="98.6">
                    </div>

                    <div>
                        <label>Weight</label>
                        <input id="consultationWeight" type="text" value="${visit.weight || ""}" placeholder="70 kg">
                    </div>
                </div>

                <label>Clinical Notes</label>
                <textarea id="consultationClinicalNotes" placeholder="General clinical notes">${visit.clinical_notes || ""}</textarea>

                <label>Diagnosis</label>
                <textarea id="consultationDiagnosis" placeholder="Final diagnosis" required></textarea>

                <label>Treatment Plan</label>
                <textarea id="consultationTreatmentPlan" placeholder="Treatment plan / prescription summary"></textarea>

                <label>Follow-up Notes</label>
                <textarea id="consultationFollowUpNotes" placeholder="Follow-up advice"></textarea>

                <h4>Doctor Custom Fields</h4>

                <div class="dynamic-consultation-fields">
                    ${
                        dynamicFields.length
                            ? dynamicFields.map((field) => renderDynamicField(field)).join("")
                            : `<p class="muted-text">No dynamic consultation fields configured.</p>`
                    }
                </div>

                ${
                    completed
                        ? `<p class="muted-text">This consultation is already completed.</p>`
                        : `<button type="submit">Complete Consultation</button>`
                }
            </form>
        `;

        const form = document.getElementById("doctorConsultationForm");

        if (form && !completed) {
            form.addEventListener("submit", completeConsultation);
        }
    }

    function renderDynamicField(field) {
        const required = field.is_required ? "required" : "";
        const placeholder = field.placeholder || "";

        if (field.field_type === "textarea") {
            return `
                <div>
                    <label>${field.field_label}</label>
                    <textarea
                        data-dynamic-field-id="${field.field_id}"
                        placeholder="${placeholder}"
                        ${required}
                    ></textarea>
                </div>
            `;
        }

        if (field.field_type === "number") {
            return `
                <div>
                    <label>${field.field_label}</label>
                    <input
                        type="number"
                        data-dynamic-field-id="${field.field_id}"
                        placeholder="${placeholder}"
                        ${required}
                    >
                </div>
            `;
        }

        if (field.field_type === "date") {
            return `
                <div>
                    <label>${field.field_label}</label>
                    <input
                        type="date"
                        data-dynamic-field-id="${field.field_id}"
                        ${required}
                    >
                </div>
            `;
        }

        if (field.field_type === "time") {
            return `
                <div>
                    <label>${field.field_label}</label>
                    <input
                        type="time"
                        data-dynamic-field-id="${field.field_id}"
                        ${required}
                    >
                </div>
            `;
        }

        if (field.field_type === "boolean") {
            return `
                <div>
                    <label>${field.field_label}</label>
                    <select data-dynamic-field-id="${field.field_id}" ${required}>
                        <option value="">Select</option>
                        <option value="yes">Yes</option>
                        <option value="no">No</option>
                    </select>
                </div>
            `;
        }

        return `
            <div>
                <label>${field.field_label}</label>
                <input
                    type="text"
                    data-dynamic-field-id="${field.field_id}"
                    placeholder="${placeholder}"
                    ${required}
                >
            </div>
        `;
    }

    async function completeConsultation(event) {
        event.preventDefault();

        if (!activeAppointmentId) {
            showMessage("No active appointment selected.", "error");
            return;
        }

        const dynamicValues = {};

        document.querySelectorAll("[data-dynamic-field-id]").forEach((input) => {
            const fieldId = input.getAttribute("data-dynamic-field-id");
            dynamicValues[fieldId] = input.value;
        });

        const payload = {
            vitals: {
                bp: document.getElementById("consultationBp").value,
                pulse: document.getElementById("consultationPulse").value,
                temperature: document.getElementById("consultationTemperature").value,
                weight: document.getElementById("consultationWeight").value
            },
            clinical_notes: document.getElementById("consultationClinicalNotes").value,
            diagnosis_text: document.getElementById("consultationDiagnosis").value,
            treatment_plan: document.getElementById("consultationTreatmentPlan").value,
            follow_up_notes: document.getElementById("consultationFollowUpNotes").value,
            dynamic_values: dynamicValues
        };

        try {
            showMessage("Completing consultation...", "pending");

            const result = await apiRequest(`/api/doctor/appointments/${activeAppointmentId}/complete`, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json"
                },
                body: JSON.stringify(payload)
            });

            showMessage(result.message, "ok");
            await loadDoctorQueue();
            await openConsultation(activeAppointmentId);
        } catch (error) {
            showMessage(error.message, "error");
        }
    }

    function handleQueueAction(event) {
        const button = event.target.closest("button[data-action]");

        if (!button) {
            return;
        }

        const card = event.target.closest(".queue-appointment-card");

        if (!card) {
            return;
        }

        const appointmentId = card.getAttribute("data-appointment-id");
        const action = button.getAttribute("data-action");

        if (action === "mark-paid") {
            markPaid(appointmentId);
        }

        if (action === "prioritize") {
            prioritizeAppointment(appointmentId);
        }

        if (action === "start") {
            startConsultation(appointmentId);
        }

        if (action === "open") {
            openConsultation(appointmentId);
        }
    }

    async function initializeDoctorQueue() {
        try {
            doctorQueueDate.value = todayIsoDate();

            await loadQueueFilters();
            await loadDoctorQueue();
        } catch (error) {
            showMessage(error.message, "error");
        }
    }

    refreshDoctorQueueButton.addEventListener("click", loadDoctorQueue);
    doctorQueueDate.addEventListener("change", loadDoctorQueue);
    doctorQueueHospital.addEventListener("change", loadDoctorQueue);
    doctorQueuePa.addEventListener("change", loadDoctorQueue);
    doctorQueueStatus.addEventListener("change", loadDoctorQueue);
    doctorQueueList.addEventListener("click", handleQueueAction);

    document.querySelectorAll(".doctor-module-tab").forEach((tab) => {
        tab.addEventListener("click", () => {
            if (tab.getAttribute("data-doctor-tab") === "doctorQueueTab") {
                initializeDoctorQueue();
            }
        });
    });

    setInterval(() => {
        const visible = !queueTab.classList.contains("hidden");

        if (visible) {
            loadDoctorQueue();
        }
    }, 30000);
});