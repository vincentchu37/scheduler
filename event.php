<?php
// Connect to SQLite database
try {
    $pdo = new PDO('sqlite:events.db');
    $pdo->setAttribute(PDO::ATTR_ERRMODE, PDO::ERRMODE_EXCEPTION);

    // Create events table if not exists
    $pdo->exec("CREATE TABLE IF NOT EXISTS events(
        uniqueid VARCHAR(255) PRIMARY KEY,
        event_name VARCHAR(255),
        start_datetime INTEGER,
        end_datetime INTEGER
    )");

    // Create availability table if not exists
    // IMPORTANT: If events.db already exists with the old schema, 
    // it must be deleted for this new schema to take effect.
    $pdo->exec("CREATE TABLE IF NOT EXISTS availability(
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        event_id VARCHAR(255),
        username VARCHAR(255),
        slot_timestamp INTEGER, -- Stores UTC epoch timestamp
        FOREIGN KEY(event_id) REFERENCES events(uniqueid),
        UNIQUE(event_id, username, slot_timestamp)
    )");

    // Create user sessions table if not exists
    $pdo->exec("CREATE TABLE IF NOT EXISTS user_sessions(
        event_id VARCHAR(255),
        username VARCHAR(255),
        last_active TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY(event_id, username),
        FOREIGN KEY(event_id) REFERENCES events(uniqueid)
    )");

    // Get current user from session or default
    session_start();
    $currentUser = isset($_SESSION['user_' . $_GET['id']]) ? $_SESSION['user_' . $_GET['id']] : 'User_Undefined1951';
    $overallAvailabilityPercentage = 0;

    // Handle user change
    if (isset($_POST['user']) && !empty($_POST['user']) && ($_POST['user'] != 'User_Undefined1951')) {
        $newUser = trim($_POST['user']);
        $_SESSION['user_' . $_GET['id']] = $newUser;
        $currentUser = $newUser;

        // Update user session in database
        $sessionStmt = $pdo->prepare("INSERT OR REPLACE INTO user_sessions(event_id, username, last_active) VALUES(?, ?, CURRENT_TIMESTAMP)");
        $sessionStmt->execute([$_GET['id'], $currentUser]);

        header("Location: ?id=" . $_GET['id']);
        exit;
    }

    // Handle availability save
    if ($_SERVER['REQUEST_METHOD'] === 'POST' && isset($_POST['form_action']) && $_POST['form_action'] === 'save_availability') {
        $eventId = $_GET['id'];
        $username = $currentUser; // Use $currentUser

        // Clear existing availability for this user and event
        $clearStmt = $pdo->prepare("DELETE FROM availability WHERE event_id = ? AND username = ?");
        $clearStmt->execute([$eventId, $username]);

        if (isset($_POST['selected_slots']) && is_array($_POST['selected_slots'])) {
            $selectedSlots = $_POST['selected_slots'];

            // Insert new availability slots
            $insertStmt = $pdo->prepare("INSERT INTO availability(event_id, username, slot_timestamp) VALUES(?, ?, ?)");

            foreach ($selectedSlots as $slotString) {
                // slotString is "YYYY-MM-DD_H" (e.g., "2023-12-25_14" or "2023-12-25_9")
                list($datePart, $hourPart) = explode('_', $slotString);
                if ($datePart && isset($hourPart)) { // Ensure both parts exist
                    try {
                        // Create DateTime object in UTC and get timestamp
                        $dt = new DateTime($datePart . ' ' . $hourPart . ':00:00', new DateTimeZone('UTC'));
                        $slot_timestamp = $dt->getTimestamp();
                        $insertStmt->execute([$eventId, $username, $slot_timestamp]);
                    } catch (Exception $e) {
                        // Handle potential DateTime creation errors, though format is controlled
                        error_log("Error creating DateTime for slot: $slotString - " . $e->getMessage());
                    }
                }
            }
        }

        // Redirect back to the event page
        header("Location: ?id=" . $eventId);
        exit;
    }

    // First check if the event exists
    $checkStmt = $pdo->prepare("SELECT * FROM events WHERE uniqueid = :uniqueid");
    $checkStmt->execute([':uniqueid' => $_GET['id']]);
    $event = $checkStmt->fetch(PDO::FETCH_ASSOC);

    if (!$event) {
        if (empty($_POST)) {
            echo "No event with this ID.";
            header('Location: .#noevent');
            die;
        }
        // Create new event
        $stmt = $pdo->prepare("INSERT INTO events(event_name, uniqueid, start_datetime, end_datetime) 
                        VALUES(:event_name, :uniqueid, :start_datetime, :end_datetime)");

        $stmt->execute([
            ':uniqueid' => $_POST['uniqueid'],
            ':event_name' => $_POST['event-name'],
            ':start_datetime' => $_POST['start-datetime-utc'],
            ':end_datetime' => $_POST['end-datetime-utc']
        ]);

        header("Refresh:0");
        exit;
    }

    // Get all users for this event
    $usersStmt = $pdo->prepare("SELECT DISTINCT username FROM user_sessions WHERE event_id = ? ORDER BY last_active DESC");
    $usersStmt->execute([$_GET['id']]);
    $eventUsers = $usersStmt->fetchAll(PDO::FETCH_COLUMN);

    // Get availability data for current user
    $availabilityStmt = $pdo->prepare("SELECT slot_timestamp FROM availability WHERE event_id = ? AND username = ?");
    $availabilityStmt->execute([$_GET['id'], $currentUser]);
    $rawUserAvailability = $availabilityStmt->fetchAll(PDO::FETCH_ASSOC);
    $userAvailability = [];
    foreach ($rawUserAvailability as $row) {
        // Convert timestamp back to UTC date and hour for JavaScript
        $dt = new DateTime('@' . $row['slot_timestamp'], new DateTimeZone('UTC'));
        $userAvailability[] = ['date' => $dt->format('Y-m-d'), 'hour' => (int)$dt->format('G')];
    }

    // Get all availability data for the event (for displaying other users' availability)
    $allAvailabilityStmt = $pdo->prepare("SELECT username, slot_timestamp FROM availability WHERE event_id = ?");
    $allAvailabilityStmt->execute([$_GET['id']]);
    $rawAllAvailability = $allAvailabilityStmt->fetchAll(PDO::FETCH_ASSOC);
    $allAvailability = [];
    foreach ($rawAllAvailability as $row) {
        // Convert timestamp back to UTC date and hour for PHP logic and JavaScript
        $dt = new DateTime('@' . $row['slot_timestamp'], new DateTimeZone('UTC'));
        $allAvailability[] = [
            'username' => $row['username'],
            'date' => $dt->format('Y-m-d'),
            'hour' => (int)$dt->format('G')
        ];
    }

    // Calculate total number of users who have interacted with the event
    $totalEventUsers = count($eventUsers);

    // Calculate per-slot availability counts
    $perSlotAvailabilityCounts = [];
    foreach ($allAvailability as $record) {
        $slotKey = $record['date'] . '_' . $record['hour'];
        $perSlotAvailabilityCounts[$slotKey] = ($perSlotAvailabilityCounts[$slotKey] ?? 0) + 1;
    }

    // Calculate per-slot availability percentages
    $perSlotAvailabilityPercentages = [];
    if ($totalEventUsers > 0) {
        foreach ($perSlotAvailabilityCounts as $slotKey => $count) {
            $perSlotAvailabilityPercentages[$slotKey] = round(($count / $totalEventUsers) * 100);
        }
    }

    // Calculate Overall Availability Percentage
    if ($event && isset($event['start_datetime'], $event['end_datetime'])) {
        $startDateTime = DateTimeImmutable::createFromFormat('U.u', sprintf('%.3f', $event['start_datetime'] / 1000))->setTimezone(new DateTimeZone('UTC'));
        $endDateTime = DateTimeImmutable::createFromFormat('U.u', sprintf('%.3f', $event['end_datetime'] / 1000))->setTimezone(new DateTimeZone('UTC'));

        $possibleSlots = [];
        $currentIterDateTime = $startDateTime;
        while ($currentIterDateTime < $endDateTime) {
            $possibleSlots[$currentIterDateTime->format('Y-m-d_G')] = true; // Use keys for uniqueness
            $currentIterDateTime = $currentIterDateTime->add(new DateInterval('PT1H'));
        }
        $totalPossibleSlots = count($possibleSlots);

        $uniqueAvailableSlotsSet = [];
        foreach ($allAvailability as $avail) {
            $uniqueAvailableSlotsSet[$avail['date'] . '_' . $avail['hour']] = true; // Use keys for uniqueness
        }
        $uniqueAvailableSlots = count($uniqueAvailableSlotsSet);

        if ($totalPossibleSlots > 0) {
            $overallAvailabilityPercentage = round(($uniqueAvailableSlots / $totalPossibleSlots) * 100);
        }
    }

    // Prepare detailed slot user information for tooltips
    $slotUserDetails = [];
    if ($event && isset($event['start_datetime'], $event['end_datetime']) && !empty($eventUsers)) {
        // Use the same $startDateTime and $endDateTime from Overall Availability Percentage calculation
        // These are DateTimeImmutable objects in UTC.
        $currentIterDateTime = $startDateTime; // Already defined above
        while ($currentIterDateTime <= $endDateTime) { // Already defined above
            $dateStr = $currentIterDateTime->format('Y-m-d');
            $hourVal = (int)$currentIterDateTime->format('G'); // Hour without leading zero, as integer
            $currentSlotKey = $dateStr . '_' . $hourVal;

            $availableForSlot = [];
            foreach ($allAvailability as $avail) {
                if ($avail['date'] === $dateStr && (int)$avail['hour'] === $hourVal) {
                    $availableForSlot[] = $avail['username'];
                }
            }
            $availableForSlotUnique = array_values(array_unique($availableForSlot));

            $unavailableForSlot = [];
            foreach ($eventUsers as $user) {
                if (!in_array($user, $availableForSlotUnique)) {
                    $unavailableForSlot[] = $user;
                }
            }
            // No need for array_unique on $unavailableForSlot as $eventUsers is already unique
            // and we are checking against availableForSlotUnique.

            $slotUserDetails[$currentSlotKey] = [
                'available' => $availableForSlotUnique,
                'unavailable' => $unavailableForSlot // array_values not strictly needed if $eventUsers has sequential keys
            ];
            $currentIterDateTime = $currentIterDateTime->add(new DateInterval('PT1H'));
        }
    }
} catch (PDOException $e) {
    if ($e->getCode() == 23000) {
        echo "Error: This event ID already exists. Try making another event.";
    } else {
        echo "Error: " . $e->getMessage();
    }
} catch (Exception $e) {
    echo "Error: " . $e->getMessage();
}
?>

<!DOCTYPE html>
<html lang="en">

<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title><?php echo $event["event_name"]; ?></title>
    <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/bootstrap/5.3.3/css/bootstrap.min.css" integrity="sha512-jnSuA4Ss2PkkikSOLtYs8BlYIeeIK1h99ty4YfvRPAlzr377vr3CXDb7sb7eEEBYjDtcYj+AjBH3FLv5uSJuXg==" crossorigin="anonymous" referrerpolicy="no-referrer" />
    <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/jqueryui/1.14.1/themes/base/theme.min.css" integrity="sha512-lfR3NT1DltR5o7HyoeYWngQbo6Ec4ITaZuIw6oAxIiCNYu22U5kpwHy9wAaN0vvBj3U6Uy2NNtAfiaKcDxfhTg==" crossorigin="anonymous" referrerpolicy="no-referrer" />
    <link rel="stylesheet" href="style.css">
    <script>
        // Make $_POST data available as a global JavaScript object
        <?php
        echo 'var data = ' . json_encode($event) . ';';
        echo 'var userAvailability = ' . json_encode($userAvailability) . ';';
        echo 'var perSlotAvailabilityPercentages = ' . json_encode($perSlotAvailabilityPercentages) . ';';
        echo 'var slotUserDetails = ' . json_encode($slotUserDetails) . ';';
        ?>
    </script>
</head>
<div class="container-fluid my-2">
    <h1 class="text-center"><?php echo $event["event_name"]; ?></h1>
    <div class="row justify-content-between mb-3">
        <div class="col-md-4">
            <div class="h6 mt-2">Current User: <?php echo htmlspecialchars($currentUser); ?></div>
        </div>
        <div class="col-md-4 d-flex justify-content-end gap-2">
            <button type="button" id="copy-link" class="btn btn-outline-primary link-copy"
                url-site="<?php echo "https://$_SERVER[HTTP_HOST]$_SERVER[REQUEST_URI]"; ?>"
                data-bs-original-title="Copy URL">
                <i class="bi-share-fill"></i> Share this with others
            </button>
            <form id="save-availability-form" action="?id=<?php echo htmlspecialchars($event["uniqueid"]); ?>" method="post">
                <input type="hidden" name="form_action" value="save_availability">
                <span id="selected-slots-container"></span>
                <button type="submit" id="save-availability" class="btn btn-success"><strong>Save My Availability</strong></button>
            </form>
        </div>
    </div>
    <!-- Calendar Container -->
    <div class="calendar-container" id="calendar-grid"></div>

</div>

<!-- Modal HTML -->
<div class="modal fade" id="user" data-bs-keyboard="false" data-bs-backdrop="static" tabindex="-1" aria-labelledby="userselect" aria-hidden="true">
    <div class="modal-dialog">
        <div class="modal-content">
            <div class="modal-header">
                <h5 class="modal-title" id="userModalLabel">Who are you?</h5>
            </div>
            <div class="modal-body">
                <form id="changeuser" action="?id=<?php echo $event["uniqueid"]; ?>" method="post">
                    <div class="input-group">
                        <input type="text" id="user" class="form-control" placeholder="Enter username" name="user">
                        <button class="btn btn-outline-secondary" type="submit">Switch User</button>
                    </div>
                </form>
            </div>
        </div>
    </div>
</div>

<script>
    document.addEventListener('DOMContentLoaded', function() {
        const userTimeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
        const select = document.getElementById('timezone');
        if (select && userTimeZone) {
            select.value = userTimeZone;
        }
        <?php 
        if ($currentUser == 'User_Undefined1951') {
            echo "var userModal = new bootstrap.Modal(document.getElementById('user'));
            userModal.show();";
        }
        ?>

    });
</script>

<script src="https://cdnjs.cloudflare.com/ajax/libs/jquery/3.7.1/jquery.min.js" integrity="sha512-v2CJ7UaYy4JwqLDIrZUI/4hqeoQieOmAZNXBeQyjo21dadnwR+8ZaIJVT8EE2iyI61OV8e6M8PP2/4hpQINQ/g==" crossorigin="anonymous" referrerpolicy="no-referrer"></script>
<script src="https://cdnjs.cloudflare.com/ajax/libs/jqueryui/1.14.1/jquery-ui.min.js" integrity="sha512-MSOo1aY+3pXCOCdGAYoBZ6YGI0aragoQsg1mKKBHXCYPIWxamwOE7Drh+N5CPgGI5SA9IEKJiPjdfqWFWmZtRA==" crossorigin="anonymous" referrerpolicy="no-referrer"></script>
<script src="https://cdnjs.cloudflare.com/ajax/libs/bootstrap/5.3.3/js/bootstrap.bundle.min.js" integrity="sha512-7Pi/otdlbbCR+LnW+F7PwFcSDJOuUJB3OxtEHbg4vSMvzvJjde4Po1v4BR9Gdc9aXNUNFVUY+SK51wWT8WF0Gg==" crossorigin="anonymous" referrerpolicy="no-referrer"></script>
<script src="cal.js"></script>

</html>