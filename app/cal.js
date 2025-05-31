let eventId; // Declare eventId here to make it accessible if needed more globally
let isSelectMode = true; // Global state for select mode
let csrfToken = '';
let saveButton = null;
let originalSaveButtonHTML = ''; // To store the initial HTML of the save button

let pollingIntervalId = null;
const POLLING_INTERVAL_MS = 15000; // 15 seconds

// Utility function to pad numbers for date/time formatting
const pad = n => String(n).padStart(2, '0');

// Debounce function
function debounce(func, delay) {
    let timeoutId;
    return function(...args) {
        clearTimeout(timeoutId);
        timeoutId = setTimeout(() => {
            func.apply(this, args);
        }, delay);
    };
}

// Function to handle the auto-save logic
function initiateAutoSave() {
    if (!saveButton) {
        console.warn('Save button not found for auto-save feedback.');
        return;
    }
    if (originalSaveButtonHTML === '') { // Store original HTML only once
        originalSaveButtonHTML = saveButton.innerHTML;
    }

    saveButton.innerHTML = 'Saving...';
    saveButton.classList.remove('btn-success', 'btn-danger', 'btn-primary');
    saveButton.classList.add('btn-info'); // Blue for saving

    const selectedSlotsContainer = document.getElementById('selected-slots-container');
    const selectedSlotInputs = selectedSlotsContainer.querySelectorAll('input[name="selected_slots[]"]');
    const selectedSlots = Array.from(selectedSlotInputs).map(input => input.value);

    if (!window.eventAppData || !window.eventAppData.event || !window.eventAppData.event.uniqueid) {
        console.error('Cannot auto-save: event uniqueid not found in window.eventAppData.');
        saveButton.innerHTML = 'Save Error!';
        saveButton.classList.remove('btn-info', 'btn-success', 'btn-primary');
        saveButton.classList.add('btn-danger');
        setTimeout(() => { 
            if (saveButton.innerHTML === 'Save Error!') {
                saveButton.innerHTML = originalSaveButtonHTML; 
                saveButton.className = 'btn btn-success'; 
            }
        }, 3000);
        return;
    }
    const currentEventId = window.eventAppData.event.uniqueid;
    // The '!currentEventId' check below is now redundant due to the comprehensive check above but kept for safety.

    if (!currentEventId) { 
        console.error('Event ID not found for auto-save (from eventAppData).');
        saveButton.innerHTML = 'Save Error!';
        saveButton.classList.remove('btn-info');
        saveButton.classList.add('btn-danger');
        setTimeout(() => { if (saveButton.innerHTML === 'Save Error!') saveButton.innerHTML = originalSaveButtonHTML; saveButton.className = 'btn btn-success';}, 3000);
        return;
    }
    if (!csrfToken) {
        console.error('CSRF token not available for auto-save.');
        saveButton.innerHTML = 'Save Error!';
        saveButton.classList.remove('btn-info');
        saveButton.classList.add('btn-danger');
        setTimeout(() => { if (saveButton.innerHTML === 'Save Error!') saveButton.innerHTML = originalSaveButtonHTML; saveButton.className = 'btn btn-success'; }, 3000);
        return;
    }

    const formData = new FormData();
    formData.append('form_action', 'save_availability');
    formData.append('csrf_token', csrfToken);
    selectedSlots.forEach(slot => {
        formData.append('selected_slots[]', slot);
    });

    fetch(`?id=${currentEventId}`, {
        method: 'POST',
        headers: {
            'X-Requested-With': 'XMLHttpRequest'
        },
        body: formData
    })
    .then(response => {
        if (!response.ok) { // Check for HTTP error status (4xx, 5xx)
            throw new Error(`HTTP error! status: ${response.status}`);
        }
        return response.json();
    })
    .then(result => {
        if (result.status === 'success') {
            saveButton.innerHTML = 'Saved ✔';
            saveButton.classList.remove('btn-info');
            saveButton.classList.add('btn-success'); // Green for saved
            
            fetchAndUpdateAggregateData(); // Update aggregate view for active user

            setTimeout(() => {
                if (saveButton.innerHTML === 'Saved ✔') {
                     saveButton.innerHTML = originalSaveButtonHTML;
                     saveButton.className = 'btn btn-success'; // Revert to original class
                }
            }, 2000);
        } else {
            saveButton.innerHTML = 'Save Failed!';
            saveButton.classList.remove('btn-info');
            saveButton.classList.add('btn-danger'); // Red for failed
            console.error('Auto-save failed:', result.message);
            // alert(`Auto-save failed: ${result.message}`); // Optional: more prominent error
            setTimeout(() => {
                if (saveButton.innerHTML === 'Save Failed!') {
                    saveButton.innerHTML = originalSaveButtonHTML;
                    saveButton.className = 'btn btn-success';
                }
            }, 3000);
        }
    })
    .catch(error => {
        saveButton.innerHTML = 'Save Error!';
        saveButton.classList.remove('btn-info');
        saveButton.classList.add('btn-danger');
        console.error('Auto-save request error:', error);
        setTimeout(() => {
            if (saveButton.innerHTML === 'Save Error!') {
                saveButton.innerHTML = originalSaveButtonHTML;
                saveButton.className = 'btn btn-success';
            }
        }, 3000);
    });
}

// Create a debounced version of the auto-save function
const debouncedAutoSave = debounce(initiateAutoSave, 1000); // 1.5 seconds


// --- Aggregate Data Polling Functions ---
function startPollingAggregateData() {
    if (pollingIntervalId) {
        clearInterval(pollingIntervalId);
        pollingIntervalId = null;
    }

    if (document.hidden) {
        return;
    }

    fetchAndUpdateAggregateData(); // Initial fetch when starting/resuming
    pollingIntervalId = setInterval(fetchAndUpdateAggregateData, POLLING_INTERVAL_MS);
}

function stopPollingAggregateData() {
    if (pollingIntervalId) {
        clearInterval(pollingIntervalId);
        pollingIntervalId = null;
    }
}
// --- End of Aggregate Data Polling Functions ---


// Function to fetch and update aggregate availability data
function fetchAndUpdateAggregateData() {
    if (!window.eventAppData || !window.eventAppData.event || !window.eventAppData.event.uniqueid) {
        console.error('Cannot fetch aggregate data: event uniqueid not found in window.eventAppData.');
        return;
    }
    const currentEventId = window.eventAppData.event.uniqueid;
    // The check '!currentEventId' below is somewhat redundant now but harmless.

    fetch(`?id=${currentEventId}&action=get_aggregate_data`)
        .then(response => {
            if (!response.ok) {
                throw new Error(`HTTP error fetching aggregate data! status: ${response.status}`);
            }
            return response.json();
        })
        .then(result => {
            if (result.status === 'success') {
                updateAggregateDisplay(result.perSlotAvailabilityPercentages, result.slotUserDetails);
            } else {
                console.error('Failed to fetch or process aggregate data:', result.message);
            }
        })
        .catch(error => {
            console.error('Error during fetchAndUpdateAggregateData:', error);
        });
}

// Function to update the display of aggregate availability (fills and tooltips)
function updateAggregateDisplay(newPercentages, newUserDetails) {
    const cells = document.querySelectorAll('#calendar-grid .calendar-cell');
    cells.forEach(cell => {
        if (cell.classList.contains('disabled-event-slot')) {
            // Skip disabled cells as they don't show aggregate data in the same way
            // Or, ensure their aggregate display is explicitly zeroed if necessary
            const aggregateFill = cell.querySelector('.aggregate-availability');
            if (aggregateFill) {
                aggregateFill.style.width = '0%';
            }
            // Tooltips on disabled cells might not exist or need specific handling if they do
            return; 
        }

        const localCellDateStr = cell.dataset.date; // e.g., "2023-12-25"
        const localCellHour = parseInt(cell.dataset.hour); // e.g., 14

        const year = parseInt(localCellDateStr.substring(0, 4));
        const month = parseInt(localCellDateStr.substring(5, 7)) - 1; // JS months 0-indexed
        const day = parseInt(localCellDateStr.substring(8, 10));
        
        let tempDate = new Date(Date.UTC(year, month, day, localCellHour)); // Treat input as UTC to get correct UTC base
        // Correction: The date parts from cell.dataset.date are LOCAL.
        // We need to create a local date object then get its UTC components.
        tempDate = new Date(year, month, day, localCellHour);

        const slotKeyUTC = tempDate.getUTCFullYear() + '-' +
                           String(tempDate.getUTCMonth() + 1).padStart(2, '0') + '-' +
                           String(tempDate.getUTCDate()).padStart(2, '0') + '_' +
                           tempDate.getUTCHours();

        // Update Aggregate Fill
        const aggregateFill = cell.querySelector('.aggregate-availability');
        if (aggregateFill) {
            const aggPercent = newPercentages[slotKeyUTC] || 0;
            aggregateFill.style.width = aggPercent + '%';
        }

        // Update Tooltip Content
        let newTooltipContentString = 'No availability data for this slot.'; // Default
        if (newUserDetails && newUserDetails[slotKeyUTC]) {
            const details = newUserDetails[slotKeyUTC];
            newTooltipContentString = ''; // Reset for building
            if (details.available && details.available.length > 0) {
                newTooltipContentString += `<strong>Available:</strong> ${details.available.join(', ')}<hr>`;
            } else {
                newTooltipContentString += '<strong>Available:</strong><hr>';
            }
            if (details.unavailable && details.unavailable.length > 0) {
                newTooltipContentString += `<strong class="text-danger">Unavailable:</strong> ${details.unavailable.join(', ')}`;
            } else {
                newTooltipContentString += '<strong class="text-danger">Unavailable:</strong>';
            }
        }
        
        cell.setAttribute('data-bs-title', newTooltipContentString);
        const tooltipInstance = bootstrap.Tooltip.getInstance(cell);
        if (tooltipInstance) {
            // Ensure the tooltip's content is updated.
            // For Bootstrap 5, setContent is the way.
            tooltipInstance.setContent({ '.tooltip-inner': newTooltipContentString });
        }
    });
}


$(document).ready(function () {
    if (!window.eventAppData || !window.eventAppData.event) {
        console.error("Critical: Event application data (window.eventAppData or eventAppData.event) not found!");
        // Display a more prominent error to the user and halt further script execution.
        document.body.innerHTML = '<div style="padding: 20px; background-color: #f8d7da; color: #721c24; border: 1px solid #f5c6cb; border-radius: .25rem; margin: 20px;">Error: Application data is missing. Cannot load event. Please try reloading or contact support if the issue persists.</div>';
        if (typeof stopPollingAggregateData === 'function') { // Check if function exists before calling
             stopPollingAggregateData(); // Stop polling if it was somehow started or could start
        }
        return; // Halt execution of $(document).ready()
    }

    // Initialize csrfToken from the global JS object
    csrfToken = window.eventAppData.csrfToken;
    if (!csrfToken) {
        console.error('CSRF token not found in window.eventAppData! Auto-save and other POST actions might fail.');
        // Depending on requirements, you might want to alert the user or disable save features.
    }

    // Initialize saveButton
    saveButton = document.getElementById('save-state');
    if (saveButton) {
        originalSaveButtonHTML = saveButton.innerHTML; // Store initial HTML
    } else {
        console.warn('Save button #save-availability not found.');
    }

    // Setup Page Visibility API listeners for polling
    document.addEventListener('visibilitychange', () => {
        if (document.hidden) {
            stopPollingAggregateData();
        } else {
            startPollingAggregateData();
        }
    });

    // Initial start of polling when page loads and is visible
    if (typeof startPollingAggregateData === 'function') startPollingAggregateData();


    // Event ID from URL params (can be kept for reference or specific use cases if any)
    const urlParams = new URLSearchParams(window.location.search);
    // eventId is a global variable, assign if needed, or prefer window.eventAppData.event.uniqueid
    eventId = urlParams.get('id'); 

    // Use data from window.eventAppData
    const currentEventDetails = window.eventAppData.event;
    const initialUserAvailability = window.eventAppData.userAvailability; // To be passed to generateCalendarGrid
    const initialPerSlotPercentages = window.eventAppData.perSlotAvailabilityPercentages; // To be passed
    const initialSlotUserDetails = window.eventAppData.slotUserDetails; // To be passed

    // Ensure essential event details are present for date calculations
    if (!currentEventDetails.start_datetime || !currentEventDetails.end_datetime) {
        console.error("Critical: Event start or end datetime is missing from eventAppData.");
        document.body.innerHTML = '<div class="alert alert-danger text-center m-3">Error: Event date information is incomplete. Cannot load event schedule.</div>';
        if (typeof stopPollingAggregateData === 'function') stopPollingAggregateData();
        return; // Halt further processing in ready()
    }

    const startUtc = currentEventDetails.start_datetime;
    const endUtc = currentEventDetails.end_datetime;

    // Create Date objects (in local timezone)
    const localStartDate = new Date(startUtc);
    const localEndDate = new Date(endUtc);

    // Format as YYYY-MM-DD using local date parts (uses global pad function)
    const formatDate = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

    // Get hour (2 digits) using local hours
    const formatHour = d => { const h = d.getHours(); return String(h).padStart(2, '0'); };

    // Build result using local dates and times
    const result = {
        "startDate": formatDate(localStartDate),
        "endDate": formatDate(localEndDate),
        "startTime": formatHour(localStartDate), // Use localStartDate
        "endTime": formatHour(localEndDate)     // Use localEndDate
    };

    document.getElementById('event-meta').innerHTML += '<b>Start Date: </b>' + result.startDate + ' <b>End Date:</b> ' + result.endDate + ' <b>Start Time:</b> ' + result.startTime + ' <b>End Time:</b> ' + result.endTime;

    generateCalendarGrid(result.startDate, result.endDate, result.startTime, result.endTime,
                         initialPerSlotPercentages, initialSlotUserDetails, initialUserAvailability);

    // Initialize Bootstrap Tooltips after calendar grid is generated
    const tooltipTriggerList = [].slice.call(document.querySelectorAll('#calendar-grid .calendar-cell[data-bs-toggle="tooltip"]'));
    tooltipTriggerList.map(function (tooltipTriggerEl) {
        return new bootstrap.Tooltip(tooltipTriggerEl, {
            boundary: document.body,
            fallbackPlacements: ['top', 'bottom', 'left', 'right']
        });
    });

    const toggleModeButton = document.getElementById('toggle-select-mode');
    if (toggleModeButton) {
        toggleModeButton.addEventListener('click', function() {
            isSelectMode = !isSelectMode;
            if (isSelectMode) {
                this.textContent = 'In Select Mode';
                this.classList.add('btn-info');
                this.classList.remove('btn-warning');
            } else {
                this.textContent = 'In Read-Only Mode';
                this.classList.remove('btn-info');
                this.classList.add('btn-warning');
                // Note: Accessing isMouseDown from setupCellInteractions' scope directly here is tricky.
                // Relying on user releasing mouse/touch for now.
            }
            // Hide any visible tooltips when switching modes
            document.querySelectorAll('#calendar-grid .calendar-cell').forEach(cell => {
                const tooltipInstance = bootstrap.Tooltip.getInstance(cell);
                if (tooltipInstance) {
                    tooltipInstance.hide();
                }
            });
        });
    }
});

document.addEventListener('DOMContentLoaded', function () {
    const copyButton = document.getElementById('copy-link');

    if (copyButton) { // Ensure button exists before adding listener
        copyButton.addEventListener('click', function () {
            // Get URL from the custom attribute
            const url = window.location.href;

            // Copy to clipboard using the modern Clipboard API
            navigator.clipboard.writeText(url)
                .then(() => {
                    // Provide visual feedback
                    const originalContent = this.innerHTML;
                    this.innerHTML = 'Copied to clipboard!';

                    // Reset button after 2 seconds
                    setTimeout(() => {
                        this.innerHTML = originalContent;
                    }, 2000);
                })
                .catch(err => {
                    console.error('Failed to copy URL:', err);
                });
        });
    }
});

// Helper function to create a calendar cell
function createCalendarCell(dateStr, hour, isWeekend, currentDate, selectedSlotsContainer, perSlotAvailabilityPercentages, slotUserDetails, userAvailability, isActuallySchedulable) {
    const cell = document.createElement('div');
    cell.className = `calendar-cell ${isWeekend ? 'weekend' : ''}`;
    
    if (!isActuallySchedulable) {
        cell.classList.add('disabled-event-slot','disabled');
    }

    cell.dataset.date = dateStr; // dateStr is local
    cell.dataset.hour = hour;    // hour is local
    cell.style.position = 'relative'; // For positioning aggregateDisplay

    // Display hour text in cell (local time)
    cell.textContent = `${hour}:00`;

    // UTC Conversion for backend data
    let slotDateTimeLocal = new Date(currentDate.getFullYear(), currentDate.getMonth(), currentDate.getDate(), hour);
    const utcYear = slotDateTimeLocal.getUTCFullYear();
    const utcMonth = slotDateTimeLocal.getUTCMonth() + 1; // getUTCMonth is 0-indexed
    const utcDay = slotDateTimeLocal.getUTCDate();
    const utcHour = slotDateTimeLocal.getUTCHours(); // Integer 0-23
    // Uses global pad function now
    const utcDateStr = `${utcYear}-${pad(utcMonth)}-${pad(utcDay)}`;
    const slotKeyUTC = `${utcDateStr}_${utcHour}`; // UTC key for slotUserDetails and perSlotAvailabilityPercentages

    // Aggregate Availability Display (as background fill) - uses UTC key
    const aggregateDisplay = document.createElement('div');
    aggregateDisplay.className = 'aggregate-availability';
    const aggPercent = perSlotAvailabilityPercentages[slotKeyUTC] || 0; // Use slotKeyUTC
    aggregateDisplay.style.position = 'absolute';
    aggregateDisplay.style.bottom = '0';
    aggregateDisplay.style.left = '0';
    aggregateDisplay.style.width = aggPercent + '%';
    aggregateDisplay.style.height = '100%';
    aggregateDisplay.style.backgroundColor = 'rgba(0, 255, 0, 0.3)'; // Semi-transparent green
    aggregateDisplay.style.zIndex = '0'; // Behind cell content (hour text)
    cell.appendChild(aggregateDisplay);

    if (isActuallySchedulable) {
        // Bootstrap Tooltip Attributes - Only set if the cell is schedulable
        let tooltipContentString = '';
        if (typeof slotUserDetails !== 'undefined' && slotUserDetails && slotUserDetails[slotKeyUTC]) { // Use slotKeyUTC
            const details = slotUserDetails[slotKeyUTC]; // Use slotKeyUTC
            if (details.available && details.available.length > 0) {
                tooltipContentString += `<strong>Available:</strong> ${details.available.join(', ')}<hr>`;
            } else {
                tooltipContentString += '<strong>Available:</strong><hr>';
            }
            if (details.unavailable && details.unavailable.length > 0) {
                tooltipContentString += `<strong class="text-danger">Unavailable:</strong> ${details.unavailable.join(', ')}`;
            } else {
                tooltipContentString += '<strong class="text-danger">Unavailable:</strong>';
            }
        } else {
            tooltipContentString = 'No availability data for this slot.';
        }
        cell.setAttribute('data-bs-toggle', 'tooltip');
        cell.setAttribute('data-bs-placement', 'top');
        cell.setAttribute('data-bs-html', 'true');
        cell.setAttribute('data-bs-title', tooltipContentString);
    }

    // Pre-select Current User's Availability & Populate Form (using UTC)
    const isCurrentUserAvailable = userAvailability.some(slot => slot.date === utcDateStr && parseInt(slot.hour) === utcHour);
    if (isCurrentUserAvailable) {
        cell.classList.add('selected');
        const hiddenInput = document.createElement('input');
        hiddenInput.type = 'hidden';
        hiddenInput.name = 'selected_slots[]';
        hiddenInput.value = `${utcDateStr}_${utcHour}`; // Value format: YYYY-MM-DD_H (UTC date_UTC hour)
        hiddenInput.id = `slot_${utcDateStr}_${utcHour}`; // ID based on UTC
        selectedSlotsContainer.appendChild(hiddenInput);
    }
    return cell;
}


function generateCalendarGrid(eventStartDateStr, eventEndDateStr, eventStartHourStrLocal, eventEndHourStrLocal, 
                              currentPerSlotPercentages, currentSlotUserDetails, currentUserAvailability) {
    const calendarGrid = document.getElementById('calendar-grid');
    calendarGrid.innerHTML = ''; // Clear existing grid
    const gridDiv = document.createElement('div');
    gridDiv.className = 'calendar-grid';

    const [startYear, startMonth, startDay] = eventStartDateStr.split('-').map(num => parseInt(num));
    const [endYear, endMonth, endDay] = eventEndDateStr.split('-').map(num => parseInt(num));
    // These are local date objects based on the event's start/end date strings (which are already local)
    const localEventStartDate = new Date(startYear, startMonth - 1, startDay);
    const localEventEndDate = new Date(endYear, endMonth - 1, endDay);

    const eventStartHourLocal = parseInt(eventStartHourStrLocal);
    const eventEndHourLocal = parseInt(eventEndHourStrLocal);

    // Calculate dayDiff using local dates
    const dayDiff = Math.floor((localEventEndDate - localEventStartDate) / (86400000));

    const selectedSlotsContainer = document.getElementById('selected-slots-container');

    for (let i = 0; i <= dayDiff; i++) {
        const currentDate = new Date(localEventStartDate); // Start with localEventStartDate for iteration
        currentDate.setDate(currentDate.getDate() + i); // Iterate day by day

        // For `dateStr`, we want the specific YYYY-MM-DD for the current day in the loop (local)
        // Uses global pad function now
        const dateStr = `${currentDate.getFullYear()}-${pad(currentDate.getMonth() + 1)}-${pad(currentDate.getDate())}`;

        const dayName = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][currentDate.getDay()];
        const dayNum = currentDate.getDate();
        const monthNum = currentDate.getMonth() + 1; // getMonth() is 0-indexed
        const isWeekend = currentDate.getDay() === 0 || currentDate.getDay() === 6;
        // const dateStr = currentDate.toISOString().split('T')[0]; // This would be UTC, change to local

        const dayCol = document.createElement('div');
        dayCol.className = 'day-col';

        const daySlot = document.createElement('div');
        daySlot.className = `day-slot calendar-header ${isWeekend ? 'weekend' : ''}`;
        daySlot.innerHTML = `<div class="date-number">${monthNum}/${dayNum}</div><div class="day-name">${dayName}</div>`;
        dayCol.appendChild(daySlot);

        const isSpanningEvent = eventStartHourLocal > eventEndHourLocal;
        const isFirstDay = currentDate.toDateString() === localEventStartDate.toDateString(); // Retained for potential future use, but not used in current simplified logic
        const isLastDay = currentDate.toDateString() === localEventEndDate.toDateString();   // Retained for potential future use, but not used in current simplified logic
        const isMiddleDay = !isFirstDay && !isLastDay; // Retained for potential future use, but not used in current simplified logic
        
        // Inside the loop for each currentDate / dayCol:

        // Redundant declarations of isFirstDay and isLastDay removed.
        // The isMiddleDay variable from the original block (around line 198) is used.
        // The commented-out isMiddleDay declaration below is also implicitly removed by this change.
        
        if (isSpanningEvent) {
            // Render "early hours" block (0 to eventEndHourLocal)
            for (let hour = 0; hour <= eventEndHourLocal; hour++) {
                let isCellSchedulable = true; // Default for this cell
                if (isFirstDay) {
                    isCellSchedulable = false; // Early hours on first day are not schedulable
                }
                const cell = createCalendarCell(dateStr, hour, isWeekend, currentDate, selectedSlotsContainer, currentPerSlotPercentages, currentSlotUserDetails, currentUserAvailability, isCellSchedulable);
                dayCol.appendChild(cell);
            }

            // Render Separator
            const separator = document.createElement('div');
            separator.className = 'time-gap-separator';
            dayCol.appendChild(separator);

            // Render "late hours" block (eventStartHourLocal to 23)
            for (let hour = eventStartHourLocal; hour <= 23; hour++) {
                let isCellSchedulable = true; // Default for this cell
                if (isLastDay) {
                    isCellSchedulable = false; // Late hours on last day are not schedulable
                }
                const cell = createCalendarCell(dateStr, hour, isWeekend, currentDate, selectedSlotsContainer, currentPerSlotPercentages, currentSlotUserDetails, currentUserAvailability, isCellSchedulable);
                dayCol.appendChild(cell);
            }
        } else {
            // Case: Non-spanning event (e.g., 09:00 - 17:00)
            // Render as a single, continuous block
            for (let hour = eventStartHourLocal; hour <= eventEndHourLocal; hour++) {
                // For non-spanning events, all rendered cells are schedulable
                const cell = createCalendarCell(dateStr, hour, isWeekend, currentDate, selectedSlotsContainer, currentPerSlotPercentages, currentSlotUserDetails, currentUserAvailability, true);
                dayCol.appendChild(cell);
            }
        }
        gridDiv.appendChild(dayCol);
    }
    calendarGrid.appendChild(gridDiv);
    setupCellInteractions();
}

function setupCellInteractions() {
    const calendarGrid = document.getElementById('calendar-grid');
    const cells = document.querySelectorAll('#calendar-grid .calendar-cell');
    const selectedSlotsContainer = document.getElementById('selected-slots-container');

    let isMouseDown = false;
    let hasDragged = false;
    let anchorCellElement = null;
    let anchorCellData = null; // { date: string, hour: int }
    let currentDragSelectMode = true; // true to select, false to deselect
    let initialCellStates = new Map(); // Stores initial selection state of all cells

    function updateCellSelection(cellElement, select, cellDate, cellHour) {
        if (cellElement.classList.contains('disabled-event-slot')) {
            return; // Do not allow selection changes for disabled-event-slots
        }
        // Convert cell's local date/hour to UTC for hidden input value/ID
        let tempDate = new Date(cellDate.substring(0,4), cellDate.substring(5,7)-1, cellDate.substring(8,10), cellHour);
        const slotValueUTC = tempDate.getUTCFullYear() + '-' + String(tempDate.getUTCMonth() + 1).padStart(2, '0') + '-' + String(tempDate.getUTCDate()).padStart(2, '0') + '_' + tempDate.getUTCHours();
        const inputId = 'slot_' + slotValueUTC;

        let changed = false;
        if (select) {
            if (!cellElement.classList.contains('selected')) {
                cellElement.classList.add('selected');
                changed = true;
            }
            if (!document.getElementById(inputId)) {
                const hiddenInput = document.createElement('input');
                hiddenInput.type = 'hidden';
                hiddenInput.name = 'selected_slots[]';
                hiddenInput.value = slotValueUTC;
                hiddenInput.id = inputId;
                selectedSlotsContainer.appendChild(hiddenInput);
                // 'changed' is already true if class was added, or this is a new selection.
                // If class was already there but input was missing, this is a correction, consider it a change.
                if(!changed) changed = true; 
            }
        } else {
            if (cellElement.classList.contains('selected')) {
                cellElement.classList.remove('selected');
                changed = true;
            }
            const existingInput = document.getElementById(inputId);
            if (existingInput) {
                selectedSlotsContainer.removeChild(existingInput);
                if(!changed) changed = true;
            }
        }

        if (changed) {
            const event = new CustomEvent('availabilityChanged', { bubbles: true });
            cellElement.dispatchEvent(event);
        }
    }

    function handleDragStart(cellElement, event) {
        if (!isSelectMode) {
            // Read-only mode: Show tooltip and prevent selection

            // Hide all other visible tooltips
            document.querySelectorAll('#calendar-grid .calendar-cell').forEach(anyCell => {
                const anyTooltipInstance = bootstrap.Tooltip.getInstance(anyCell);
                if (anyTooltipInstance) {
                    anyTooltipInstance.hide();
                }
            });

            // Show the tooltip for the clicked cell
            const tooltipInstance = bootstrap.Tooltip.getInstance(cellElement);
            if (tooltipInstance) {
                tooltipInstance.show();
            }
            // isMouseDown remains false (its default or from previous state), so drag won't start.
            event.preventDefault(); // Prevent default actions like text selection
            return; // Exit before setting isMouseDown = true or other drag-related logic
        }

        // Original logic for select mode starts here
        if (cellElement.classList.contains('disabled-event-slot')) {
            // isMouseDown = false; // This needs to be isMouseDown declared in the outer scope of setupCellInteractions
            // This will be handled by the fact that we return before isMouseDown is set to true if not in select mode
            event.preventDefault(); // Prevent any default action like text selection
            return; // Exit the function early, do not process click/drag on disabled slot
        }
        event.preventDefault();
        isMouseDown = true; // This is the isMouseDown from setupCellInteractions' scope
        hasDragged = false;
        anchorCellElement = cellElement;
        anchorCellData = { date: cellElement.dataset.date, hour: parseInt(cellElement.dataset.hour) };
        currentDragSelectMode = !cellElement.classList.contains('selected');
        
        initialCellStates.clear();
        document.querySelectorAll('#calendar-grid .calendar-cell').forEach(c => {
            initialCellStates.set(c.dataset.date + '_' + c.dataset.hour, c.classList.contains('selected'));
        });

        const tooltipInstance = bootstrap.Tooltip.getInstance(anchorCellElement);
        if (tooltipInstance) {
            tooltipInstance.hide();
        }
    }

    function handleDragMove(clientX, clientY) {
        if (!isMouseDown) return;
        hasDragged = true;

        // Determine current hover cell from clientX, clientY
        // This requires a bit more logic if not directly using event.target
        // For mousemove, event.target within the calendarGrid listener is usually sufficient
        // For touchmove, you'd use document.elementFromPoint(clientX, clientY)
        let currentHoverCell = document.elementFromPoint(clientX, clientY);
        if (currentHoverCell && !currentHoverCell.classList.contains('calendar-cell')) {
            currentHoverCell = currentHoverCell.closest('.calendar-cell');
        }
        
        if (!currentHoverCell) return; // Not over a cell

        const currentHoverDate = currentHoverCell.dataset.date;
        const currentHoverHour = parseInt(currentHoverCell.dataset.hour);

        if (!anchorCellData) return; // Should not happen if isMouseDown is true

        const minDate = (anchorCellData.date < currentHoverDate) ? anchorCellData.date : currentHoverDate;
        const maxDate = (anchorCellData.date > currentHoverDate) ? anchorCellData.date : currentHoverDate;
        const minHour = (anchorCellData.hour < currentHoverHour) ? anchorCellData.hour : currentHoverHour;
        const maxHour = (anchorCellData.hour > currentHoverHour) ? anchorCellData.hour : currentHoverHour;
        
        document.querySelectorAll('#calendar-grid .calendar-cell').forEach(cellToUpdate => {
            const cellDate = cellToUpdate.dataset.date;
            const cellHour = parseInt(cellToUpdate.dataset.hour);
            const cellKey = cellDate + '_' + cellHour;
            
            if (cellDate >= minDate && cellDate <= maxDate && cellHour >= minHour && cellHour <= maxHour) {
                // Cell is IN the rectangle
                updateCellSelection(cellToUpdate, currentDragSelectMode, cellDate, cellHour);
            } else {
                // Cell is OUTSIDE the rectangle - revert to initial state
                const initialStateSelected = initialCellStates.get(cellKey);
                updateCellSelection(cellToUpdate, initialStateSelected, cellDate, cellHour);
            }
        });
    }

    function handleDragEnd() {
        if (!isMouseDown) return;

        if (!hasDragged && anchorCellElement) { 
             // This was a click, not a drag
            updateCellSelection(anchorCellElement, currentDragSelectMode, anchorCellData.date, anchorCellData.hour);
        }
        
        // Reset all state variables
        isMouseDown = false;
        hasDragged = false;
        anchorCellElement = null;
        anchorCellData = null;
        initialCellStates.clear();
    }

    cells.forEach(cell => {
        cell.addEventListener('mousedown', (e) => handleDragStart(cell, e));
        cell.addEventListener('touchstart', function(e) {
            // Pass the cell element and the event itself to handleDragStart.
            // handleDragStart will call e.preventDefault() internally.
            handleDragStart(this, e); 
        });
    });

    // Add event listener for custom 'availabilityChanged' event
    const calendarGridForListener = document.getElementById('calendar-grid');
    if (calendarGridForListener) {
        calendarGridForListener.addEventListener('availabilityChanged', function(event) {
            debouncedAutoSave();
        });
    }

    calendarGrid.addEventListener('mousemove', (e) => {
        // For mousemove, event.target is reliable if the listener is on calendarGrid
        // and we use e.target.closest('.calendar-cell')
        // However, to align with the generic clientX/clientY for touch, we can pass those.
        handleDragMove(e.clientX, e.clientY);
    });

    calendarGrid.addEventListener('touchmove', function(e) {
        if (!isMouseDown) return; // isMouseDown is set by handleDragStart

        // Prevent scrolling while dragging to select
        e.preventDefault(); 

        if (e.touches.length > 0) {
            const touch = e.touches[0];
            handleDragMove(touch.clientX, touch.clientY);
        }
    });

    document.addEventListener('mouseup', handleDragEnd);
    document.addEventListener('touchend', function(e) {
        // Check if isMouseDown was true, as touchend can fire for various reasons.
        if (isMouseDown) { 
            handleDragEnd();
        }
    });
}