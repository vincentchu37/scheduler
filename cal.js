$(document).ready(function () {
    let isDragging = false;
    let isSelecting = false;
    let eventId = null;

    // Check if there's an event ID in the URL
    const urlParams = new URLSearchParams(window.location.search);
    eventId = urlParams.get('event');

    // console.log(data); // Commented out
    const startUtc = data["start_datetime"];
    const endUtc = data["end_datetime"];

    // Create Date objects (in local timezone)
    const localStartDate = new Date(startUtc);
    const localEndDate = new Date(endUtc);

    // Pad function for formatting dates and hours
    const pad = n => String(n).padStart(2, '0');

    // Format as YYYY-MM-DD using local date parts
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

    // console.log(result); // Commented out

    //generateCalendarGrid("2025-05-19", "2025-05-26", "17", "22");
    generateCalendarGrid(result.startDate, result.endDate, result.startTime, result.endTime);

    // Initialize Bootstrap Tooltips after calendar grid is generated
    const tooltipTriggerList = [].slice.call(document.querySelectorAll('#calendar-grid .calendar-cell[data-bs-toggle="tooltip"]'));
    tooltipTriggerList.map(function (tooltipTriggerEl) {
        return new bootstrap.Tooltip(tooltipTriggerEl, {
            boundary: document.body, 
            fallbackPlacements: ['top', 'bottom', 'left', 'right']
        });
    });
});

document.addEventListener('DOMContentLoaded', function () {
    const copyButton = document.getElementById('copy-link');

    if (copyButton) { // Ensure button exists before adding listener
        copyButton.addEventListener('click', function () {
            // Get URL from the custom attribute
            const url = this.getAttribute('url-site');

            // Copy to clipboard using the modern Clipboard API
            navigator.clipboard.writeText(url)
                .then(() => {
                    // Provide visual feedback
                    const originalContent = this.innerHTML;
                    this.innerHTML = '<i class="bi-check"></i> Copied to clipboard!';

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
function createCalendarCell(dateStr, hour, isWeekend, currentDate, selectedSlotsContainer, perSlotAvailabilityPercentages, slotUserDetails, userAvailability) {
    const cell = document.createElement('div');
    cell.className = `calendar-cell ${isWeekend ? 'weekend' : ''}`;
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
    const pad = n => String(n).padStart(2, '0'); // Ensure pad is available
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

    // Bootstrap Tooltip Attributes
    let tooltipContentString = '';
    if (typeof slotUserDetails !== 'undefined' && slotUserDetails && slotUserDetails[slotKeyUTC]) { // Use slotKeyUTC
        const details = slotUserDetails[slotKeyUTC]; // Use slotKeyUTC
        if (details.available && details.available.length > 0) {
            tooltipContentString += `<strong>Available:</strong> ${details.available.join(', ')}<br>`;
        } else {
            tooltipContentString += '<strong>Available:</strong> None<br>';
        }
        if (details.unavailable && details.unavailable.length > 0) {
            tooltipContentString += `<strong>Unavailable:</strong> ${details.unavailable.join(', ')}`;
        } else {
            tooltipContentString += '<strong>Unavailable:</strong> None';
        }
    } else {
        tooltipContentString = 'No availability data for this slot.';
    }
    cell.setAttribute('data-bs-toggle', 'tooltip');
    cell.setAttribute('data-bs-placement', 'top');
    cell.setAttribute('data-bs-html', 'true');
    cell.setAttribute('data-bs-title', tooltipContentString);

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


function generateCalendarGrid(eventStartDateStr, eventEndDateStr, eventStartHourStrLocal, eventEndHourStrLocal) {
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
        const pad = n => String(n).padStart(2, '0'); // Ensure pad is available or define locally
        const dateStr = `${currentDate.getFullYear()}-${pad(currentDate.getMonth() + 1)}-${pad(currentDate.getDate())}`;
        
        const dayName = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][currentDate.getDay()];
        const dayNum = currentDate.getDate();
        const isWeekend = currentDate.getDay() === 0 || currentDate.getDay() === 6;
        // const dateStr = currentDate.toISOString().split('T')[0]; // This would be UTC, change to local

        let loopStartHour;
        let inclusiveLoopEndHour; 

        const dayCol = document.createElement('div');
        dayCol.className = 'day-col';

        const daySlot = document.createElement('div');
        daySlot.className = `day-slot calendar-header ${isWeekend ? 'weekend' : ''}`;
        daySlot.innerHTML = `<div class="date-number">${dayNum}</div><div class="day-name">${dayName}</div>`;
        dayCol.appendChild(daySlot);

        // New conditional logic for spanning events
        const isSpanningEvent = eventStartHourLocal > eventEndHourLocal;
        const isFirstDay = currentDate.toDateString() === localEventStartDate.toDateString();
        const isLastDay = currentDate.toDateString() === localEventEndDate.toDateString();
        const isMiddleDay = !isFirstDay && !isLastDay;

        if (isSpanningEvent && isMiddleDay) {
            // First Block (Early Hours) for middle day of spanning event
            for (let hour = 0; hour <= eventEndHourLocal; hour++) {
                const cell = createCalendarCell(dateStr, hour, isWeekend, currentDate, selectedSlotsContainer, perSlotAvailabilityPercentages, slotUserDetails, userAvailability);
                dayCol.appendChild(cell);
            }

            // Separator
            const separator = document.createElement('div');
            separator.className = 'time-gap-separator';
            // You might want to add some text or style to the separator
            // separator.textContent = '---'; 
            dayCol.appendChild(separator);

            // Second Block (Late Hours) for middle day of spanning event
            for (let hour = eventStartHourLocal; hour <= 23; hour++) {
                const cell = createCalendarCell(dateStr, hour, isWeekend, currentDate, selectedSlotsContainer, perSlotAvailabilityPercentages, slotUserDetails, userAvailability);
                dayCol.appendChild(cell);
            }
        } else {
            // Existing logic for first/last day of spanning event, or any day of non-spanning event
            if (eventStartHourLocal <= eventEndHourLocal) { // Non-spanning or single day
                loopStartHour = eventStartHourLocal;
                inclusiveLoopEndHour = eventEndHourLocal;
            } else { // Spanning event - first or last day
                if (isFirstDay) {
                    loopStartHour = eventStartHourLocal;
                    inclusiveLoopEndHour = 23;
                } else { // isLastDay (because isMiddleDay is handled above)
                    loopStartHour = 0;
                    inclusiveLoopEndHour = eventEndHourLocal;
                }
            }
            for (let hour = loopStartHour; hour <= inclusiveLoopEndHour; hour++) {
                const cell = createCalendarCell(dateStr, hour, isWeekend, currentDate, selectedSlotsContainer, perSlotAvailabilityPercentages, slotUserDetails, userAvailability);
                dayCol.appendChild(cell);
            }
        }
        gridDiv.appendChild(dayCol);
    }
    calendarGrid.appendChild(gridDiv);
    setupCellInteractions();
}

function setupCellInteractions() {
    const cells = document.querySelectorAll('.calendar-cell');
    let isDragging = false;
    let isSelecting = false; // Whether we're selecting or deselecting
    const selectedSlotsContainer = document.getElementById('selected-slots-container');
    const pad = n => String(n).padStart(2, '0'); // Ensure pad is available

    cells.forEach(cell => {
        const processCellInteraction = (currentCell, isMouseDown) => {
            if (isMouseDown) { // Only set isSelecting on mousedown
                isSelecting = !currentCell.classList.contains('selected');
            }

            const cellDateLocal = currentCell.dataset.date; // Local date string e.g., "2023-12-25"
            const cellHourLocal = parseInt(currentCell.dataset.hour); // Local hour

            let interactionSlotLocal = new Date(cellDateLocal.substring(0,4), cellDateLocal.substring(5,7)-1, cellDateLocal.substring(8,10), cellHourLocal);
            const interactionUtcYear = interactionSlotLocal.getUTCFullYear();
            const interactionUtcMonth = interactionSlotLocal.getUTCMonth() + 1;
            const interactionUtcDay = interactionSlotLocal.getUTCDate();
            const interactionUtcHour = interactionSlotLocal.getUTCHours();
            
            const interactionUtcDateStr = `${interactionUtcYear}-${pad(interactionUtcMonth)}-${pad(interactionUtcDay)}`;
            const slotValueUTC = `${interactionUtcDateStr}_${interactionUtcHour}`;
            const inputIdUTC = `slot_${interactionUtcDateStr}_${interactionUtcHour}`;

            if (isSelecting) {
                currentCell.classList.add('selected');
                if (!document.getElementById(inputIdUTC)) {
                    const hiddenInput = document.createElement('input');
                    hiddenInput.type = 'hidden';
                    hiddenInput.name = 'selected_slots[]';
                    hiddenInput.value = slotValueUTC;
                    hiddenInput.id = inputIdUTC;
                    selectedSlotsContainer.appendChild(hiddenInput);
                }
            } else {
                currentCell.classList.remove('selected');
                const existingInput = document.getElementById(inputIdUTC);
                if (existingInput) {
                    selectedSlotsContainer.removeChild(existingInput);
                }
            }
        };

        cell.addEventListener('mousedown', (e) => {
            const tooltipInstance = bootstrap.Tooltip.getInstance(cell);
            if (tooltipInstance) {
                tooltipInstance.hide();
            }
            e.preventDefault();
            isDragging = true;
            processCellInteraction(cell, true); // Pass true for isMouseDown
        });

        cell.addEventListener('mouseenter', () => {
            if (isDragging) {
                processCellInteraction(cell, false); // Pass false for isMouseDown
            }
        });
    });

    document.addEventListener('mouseup', () => {
        isDragging = false;
    });
}