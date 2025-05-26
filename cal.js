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
                const cell = createCalendarCell(dateStr, hour, isWeekend, currentDate, selectedSlotsContainer, perSlotAvailabilityPercentages, slotUserDetails, userAvailability, isCellSchedulable);
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
                const cell = createCalendarCell(dateStr, hour, isWeekend, currentDate, selectedSlotsContainer, perSlotAvailabilityPercentages, slotUserDetails, userAvailability, isCellSchedulable);
                dayCol.appendChild(cell);
            }
        } else {
            // Case: Non-spanning event (e.g., 09:00 - 17:00)
            // Render as a single, continuous block
            for (let hour = eventStartHourLocal; hour <= eventEndHourLocal; hour++) {
                // For non-spanning events, all rendered cells are schedulable
                const cell = createCalendarCell(dateStr, hour, isWeekend, currentDate, selectedSlotsContainer, perSlotAvailabilityPercentages, slotUserDetails, userAvailability, true);
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

        if (select) {
            cellElement.classList.add('selected');
            if (!document.getElementById(inputId)) {
                const hiddenInput = document.createElement('input');
                hiddenInput.type = 'hidden';
                hiddenInput.name = 'selected_slots[]';
                hiddenInput.value = slotValueUTC;
                hiddenInput.id = inputId;
                selectedSlotsContainer.appendChild(hiddenInput);
            }
        } else {
            cellElement.classList.remove('selected');
            const existingInput = document.getElementById(inputId);
            if (existingInput) {
                selectedSlotsContainer.removeChild(existingInput);
            }
        }
    }

    function handleDragStart(cellElement, event) {
        if (cellElement.classList.contains('disabled-event-slot')) {
            isMouseDown = false; // Ensure no drag operation starts or continues
            event.preventDefault(); // Prevent any default action like text selection
            return; // Exit the function early, do not process click/drag on disabled slot
        }
        event.preventDefault();
        isMouseDown = true;
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