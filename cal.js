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

});

document.addEventListener('DOMContentLoaded', function () {
    const copyButton = document.getElementById('copy-link');

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
});




$('#save-availability').on('click', function () {
    if (!eventId) {
        alert('Please create or load a calendar first');
        return;
    }

    const userName = $('#name-input').val();
    if (!userName) {
        alert('Please enter your name');
        return;
    }

    saveAvailabilityData(eventId, userName);
});

function generateCalendarGrid(startDate, endDate, startTime, endTime) {
    // Parse dates and times properly
    const [startYear, startMonth, startDay] = startDate.split('-').map(num => parseInt(num));
    const [endYear, endMonth, endDay] = endDate.split('-').map(num => parseInt(num));
    const startDateObj = new Date(startYear, startMonth - 1, startDay);
    const endDateObj = new Date(endYear, endMonth - 1, endDay);
    // Calculate days between start and end dates (inclusive)
    const dayDiff = Math.floor((endDateObj - startDateObj) / (86400000));
    let startHour = parseInt(startTime.split(':')[0]);
    let endHour = parseInt(endTime.split(':')[0]);
    // Generate calendar grid HTML
    let calendarHTML = '<div class="calendar-grid">';
    // Create rows for each day (instead of for each hour)
    for (let i = 0; i <= dayDiff; i++) {
        const currentDate = new Date(startDateObj);
        currentDate.setDate(currentDate.getDate() + i);
        const dayName = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][currentDate.getDay()];
        const dayNum = currentDate.getDate();
        const isWeekend = currentDate.getDay() === 0 || currentDate.getDay() === 6;
        const dateStr = currentDate.toISOString().split('T')[0];
        // Start a new row for this day
        calendarHTML += `<div class="day-col">`;
        // Add day label as the first cell in the row
        calendarHTML += `<div class="day-slot calendar-header ${isWeekend ? 'weekend' : ''}">
            <div class="date-number">${dayNum}</div>
            <div class="day-name">${dayName}</div>
        </div>`;
        // Add cells for each hour (columns)
        for (let hour = startHour; hour <= endHour; hour++) {
            calendarHTML += `<div class="calendar-cell ${isWeekend ? 'weekend' : ''}" data-date="${dateStr}" data-hour="${hour}">${hour}:00</div>`;
        }
        // Close the row
        calendarHTML += `</div>`;
    }

    calendarHTML += '</div>'; // Close calendar grid

    // Add the calendar to the page (using vanilla JS instead of jQuery)
    document.getElementById('calendar-grid').innerHTML = calendarHTML;

    // Set up cell interactions
    setupCellInteractions();
}


// Adding the missing function for cell interactions
function setupCellInteractions() {
    const cells = document.querySelectorAll('.calendar-cell');
    let isDragging = false;
    let isSelecting = false; // Whether we're selecting or deselecting

    cells.forEach(cell => {
        // Handle mouse down on cell
        cell.addEventListener('mousedown', (e) => {
            e.preventDefault();
            isDragging = true;
            isSelecting = !cell.classList.contains('selected');

            // Toggle selection state
            if (isSelecting) {
                cell.classList.add('selected');
            } else {
                cell.classList.remove('selected');
            }
        });

        // Handle mouse enter while dragging
        cell.addEventListener('mouseenter', () => {
            if (isDragging) {
                if (isSelecting) {
                    cell.classList.add('selected');
                } else {
                    cell.classList.remove('selected');
                }
            }
        });
    });

    // Stop dragging on mouse up anywhere in document
    document.addEventListener('mouseup', () => {
        isDragging = false;
    });
}


function setupCellInteractions() {
    $('.calendar-cell').on('mousedown', function (e) {
        e.preventDefault();
        isDragging = true;
        isSelecting = !$(this).hasClass('selected');

        $(this).toggleClass('selected');
    });

    $('.calendar-cell').on('mouseover', function () {
        if (isDragging) {
            if (isSelecting) {
                $(this).addClass('selected');
            } else {
                $(this).removeClass('selected');
            }
        }
    });

    $(document).on('mouseup', function () {
        isDragging = false;
    });
}