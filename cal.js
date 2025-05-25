$(document).ready(function () {
    let isDragging = false;
    let isSelecting = false;
    let eventId = null;

    // Check if there's an event ID in the URL
    const urlParams = new URLSearchParams(window.location.search);
    eventId = urlParams.get('event');

    // Parse to integers
    console.log(data);
    const startUtc = data["start_datetime"];
    const endUtc = data["end_datetime"];

    // Create Date objects (in local timezone)
    const startDate = new Date(startUtc);
    const endDate = new Date(endUtc);

    // Format as YYYY-MM-DD
    const pad = n => n < 10 ? '0' + n : n;
    const formatDate = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

    // Get hour (2 digits)
    const formatHour = d => pad(d.getHours());

    // Build result
    const result = {
        "startDate": formatDate(startDate),
        "endDate": formatDate(endDate),
        "startTime": formatHour(startDate),
        "endTime": formatHour(endDate)
    };

    console.log(result);

    //generateCalendarGrid("2025-05-19", "2025-05-26", "17", "22");
    generateCalendarGrid(result.startDate, result.endDate, String(result.startTime), String(result.endTime));

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


function generateCalendarGrid(startDate, endDate, startTime, endTime) {
    const calendarGrid = document.getElementById('calendar-grid');
    calendarGrid.innerHTML = ''; // Clear existing grid
    const gridDiv = document.createElement('div');
    gridDiv.className = 'calendar-grid';

    const [startYear, startMonth, startDay] = startDate.split('-').map(num => parseInt(num));
    const [endYear, endMonth, endDay] = endDate.split('-').map(num => parseInt(num));
    const startDateObj = new Date(startYear, startMonth - 1, startDay);
    const endDateObj = new Date(endYear, endMonth - 1, endDay);

    const dayDiff = Math.floor((endDateObj - startDateObj) / (86400000));
    let startHour = parseInt(startTime); // startTime is already a string like "09" or "17"
    let endHour = parseInt(endTime);

    const selectedSlotsContainer = document.getElementById('selected-slots-container');

    for (let i = 0; i <= dayDiff; i++) {
        const currentDate = new Date(startDateObj);
        currentDate.setDate(currentDate.getDate() + i);
        const dayName = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][currentDate.getDay()];
        const dayNum = currentDate.getDate();
        const isWeekend = currentDate.getDay() === 0 || currentDate.getDay() === 6;
        const dateStr = currentDate.toISOString().split('T')[0];

        const dayCol = document.createElement('div');
        dayCol.className = 'day-col';

        const daySlot = document.createElement('div');
        daySlot.className = `day-slot calendar-header ${isWeekend ? 'weekend' : ''}`;
        daySlot.innerHTML = `<div class="date-number">${dayNum}</div><div class="day-name">${dayName}</div>`;
        dayCol.appendChild(daySlot);

        for (let hour = startHour; hour <= endHour; hour++) {
            const cell = document.createElement('div');
            cell.className = `calendar-cell ${isWeekend ? 'weekend' : ''}`;
            cell.dataset.date = dateStr;
            cell.dataset.hour = hour; // Store hour as a number, e.g., 9, 17
            cell.style.position = 'relative'; // For positioning aggregateDisplay

            // Display hour text in cell
            // This text node should be on top of the aggregateDisplay due to z-index and stacking context
            cell.textContent = `${hour}:00`; 

            // Aggregate Availability Display (as background fill)
            const aggregateDisplay = document.createElement('div');
            aggregateDisplay.className = 'aggregate-availability';
            const currentSlotKey = `${dateStr}_${hour}`; // Key format: YYYY-MM-DD_H
            const aggPercent = perSlotAvailabilityPercentages[currentSlotKey] || 0;

            aggregateDisplay.style.position = 'absolute';
            aggregateDisplay.style.bottom = '0';
            aggregateDisplay.style.left = '0';
            aggregateDisplay.style.width = aggPercent + '%';
            aggregateDisplay.style.height = '100%';
            aggregateDisplay.style.backgroundColor = 'rgba(0, 255, 0, 0.3)'; // Semi-transparent green
            aggregateDisplay.style.zIndex = '0'; // Behind cell content (hour text)
            
            cell.appendChild(aggregateDisplay);

            // Bootstrap Tooltip Attributes
            // Use dateStr from the outer loop and hour from the current cell's loop iteration.
            // cell.dataset.date (which is dateStr) and cell.dataset.hour (which is loop's hour) were set prior.
            const slotKey = `${dateStr}_${hour}`; // 'hour' here is the loop variable, 'dateStr' is from the outer loop.
            let tooltipContentString = '';
            
            if (typeof slotUserDetails !== 'undefined' && slotUserDetails && slotUserDetails[slotKey]) {
                const details = slotUserDetails[slotKey];
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
            
            // Pre-select Current User's Availability & Populate Form
            // Ensure userAvailability hours are compared as numbers
            const isCurrentUserAvailable = userAvailability.some(slot => slot.date === dateStr && parseInt(slot.hour) === hour);
            if (isCurrentUserAvailable) {
                cell.classList.add('selected');
                const hiddenInput = document.createElement('input');
                hiddenInput.type = 'hidden';
                hiddenInput.name = 'selected_slots[]';
                hiddenInput.value = `${dateStr}_${hour}`; // Value format: YYYY-MM-DD_H
                hiddenInput.id = `slot_${dateStr}_${hour}`;
                selectedSlotsContainer.appendChild(hiddenInput);
            }
            dayCol.appendChild(cell);
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

    cells.forEach(cell => {
        cell.addEventListener('mousedown', (e) => {
            // Hide Bootstrap tooltip if it exists for this cell
            const tooltipInstance = bootstrap.Tooltip.getInstance(cell);
            if (tooltipInstance) {
                tooltipInstance.hide();
            }

            e.preventDefault();
            isDragging = true;
            isSelecting = !cell.classList.contains('selected');
            
            const cellDate = cell.dataset.date;
            const cellHour = cell.dataset.hour; // This is a string, but comparison/key formation should be fine
            const slotValue = `${cellDate}_${cellHour}`; // Format: YYYY-MM-DD_H
            const inputId = `slot_${cellDate}_${cellHour}`;

            if (isSelecting) {
                cell.classList.add('selected');
                if (!document.getElementById(inputId)) {
                    const hiddenInput = document.createElement('input');
                    hiddenInput.type = 'hidden';
                    hiddenInput.name = 'selected_slots[]';
                    hiddenInput.value = slotValue;
                    hiddenInput.id = inputId;
                    selectedSlotsContainer.appendChild(hiddenInput);
                }
            } else {
                cell.classList.remove('selected');
                const existingInput = document.getElementById(inputId);
                if (existingInput) {
                    selectedSlotsContainer.removeChild(existingInput);
                }
            }
        });

        cell.addEventListener('mouseenter', () => {
            if (isDragging) {
                const cellDate = cell.dataset.date;
                const cellHour = cell.dataset.hour;
                const slotValue = `${cellDate}_${cellHour}`;
                const inputId = `slot_${cellDate}_${cellHour}`;

                if (isSelecting) {
                    cell.classList.add('selected');
                    if (!document.getElementById(inputId)) {
                        const hiddenInput = document.createElement('input');
                        hiddenInput.type = 'hidden';
                        hiddenInput.name = 'selected_slots[]';
                        hiddenInput.value = slotValue;
                        hiddenInput.id = inputId;
                        selectedSlotsContainer.appendChild(hiddenInput);
                    }
                } else {
                    cell.classList.remove('selected');
                    const existingInput = document.getElementById(inputId);
                    if (existingInput) {
                        selectedSlotsContainer.removeChild(existingInput);
                    }
                }
            }
        });
    });

    document.addEventListener('mouseup', () => {
        isDragging = false;
    });
}