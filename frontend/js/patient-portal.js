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

    const API_BASE_URL = isLocalFrontend
        ? window.HM_CONFIG.LOCAL_API_URL
        : window.HM_CONFIG.PRODUCTION_API_URL;

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

        const result = await response.json();

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
                <div class="compact-item">
                    <strong>${formatDateTime(item.appointment_datetime)}</strong>
                    <span>Doctor: ${item.doctor_name} (${item.specialization || "Doctor"})</span>
                    <span>Hospital: ${item.hospital_name} - ${item.hospital_city || ""}</span>
                    <span>Diagnosis: ${item.diagnosis_text || "N/A"}</span>
                    <span>Treatment: ${item.treatment_plan || "N/A"}</span>
                    <span>Follow-up: ${item.follow_up_notes || "N/A"}</span>
                </div>
            `;
        }).join("");
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

    loadPatientPortal();
});