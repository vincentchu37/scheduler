<?php
// Connect to SQLite database
try {
    $pdo = new PDO('sqlite:db/events.db');
    $pdo->setAttribute(PDO::ATTR_ERRMODE, PDO::ERRMODE_EXCEPTION);
    $pdo->exec("PRAGMA journal_mode = WAL;");

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

    // Create event_meta table if not exists
    $pdo->exec("CREATE TABLE IF NOT EXISTS event_meta (
        meta_key VARCHAR(255) PRIMARY KEY,
        meta_value TEXT
    )");

    // --- Automatic Cleanup of Old Events ---
    try {
        $cleanup_interval_seconds = 24 * 60 * 60; // 24 hours (adjust as needed)

        $stmt_get_ts = $pdo->prepare("SELECT meta_value FROM event_meta WHERE meta_key = 'last_cleanup_timestamp'");
        $stmt_get_ts->execute();
        $last_cleanup_ts_row = $stmt_get_ts->fetch(PDO::FETCH_ASSOC);
        $last_cleanup_ts = $last_cleanup_ts_row ? (int)$last_cleanup_ts_row['meta_value'] : 0;

        if ((time() - $last_cleanup_ts) > $cleanup_interval_seconds) {
            error_log("Event Cleanup: Starting automatic cleanup of old events."); // Log start

            $ninety_days_ago_seconds = time() - (90 * 24 * 60 * 60);
            $ninety_days_ago_milliseconds = $ninety_days_ago_seconds * 1000;

            $stmt_select_old = $pdo->prepare("SELECT uniqueid FROM events WHERE end_datetime < :cutoff_time");
            $stmt_select_old->execute([':cutoff_time' => $ninety_days_ago_milliseconds]);
            $events_to_delete = $stmt_select_old->fetchAll(PDO::FETCH_COLUMN);

            $deleted_count = 0;
            if (!empty($events_to_delete)) {
                $stmt_delete_availability = $pdo->prepare("DELETE FROM availability WHERE event_id = :event_id");
                $stmt_delete_sessions = $pdo->prepare("DELETE FROM user_sessions WHERE event_id = :event_id");
                $stmt_delete_event = $pdo->prepare("DELETE FROM events WHERE uniqueid = :uniqueid");

                foreach ($events_to_delete as $uid) {
                    try {
                        $pdo->beginTransaction();
                        $stmt_delete_availability->execute([':event_id' => $uid]);
                        $stmt_delete_sessions->execute([':event_id' => $uid]);
                        $stmt_delete_event->execute([':uniqueid' => $uid]);
                        $pdo->commit();
                        $deleted_count++;
                    } catch (Exception $e) {
                        $pdo->rollBack();
                        error_log("Event Cleanup: Failed to delete event $uid: " . $e->getMessage());
                    }
                }
            }

            if ($deleted_count > 0) {
                error_log("Event Cleanup: Successfully deleted $deleted_count old event(s).");
            } else {
                error_log("Event Cleanup: No old events found to delete.");
            }

            // Update last cleanup timestamp
            $stmt_update_ts = $pdo->prepare("INSERT OR REPLACE INTO event_meta (meta_key, meta_value) VALUES ('last_cleanup_timestamp', ?)");
            $stmt_update_ts->execute([time()]); // Store current UNIX timestamp (seconds)
            error_log("Event Cleanup: Updated last_cleanup_timestamp.");
        } else {
            // Optional: Log that cleanup was skipped due to interval
            // error_log("Event Cleanup: Skipped, interval not yet passed.");
        }
    } catch (Exception $e) {
        error_log("Event Cleanup: Error during cleanup process: " . $e->getMessage());
    }
    // --- End of Automatic Cleanup ---

    // Function to fetch and calculate aggregate event data
    function getEventAggregateData(PDO $pdo, string $eventId, array $eventDetails): array
    {
        // 1. Get all users for this event (from user_sessions for anyone who has interacted)
        $usersStmt = $pdo->prepare("SELECT DISTINCT username FROM user_sessions WHERE event_id = ? ORDER BY last_active DESC");
        $usersStmt->execute([$eventId]);
        $rawEventUsers = $usersStmt->fetchAll(PDO::FETCH_COLUMN);
        $eventUsers = [];
        foreach ($rawEventUsers as $user) {
            $eventUsers[] = htmlspecialchars($user, ENT_QUOTES, 'UTF-8');
        }
        $totalEventUsers = count($eventUsers);

        // 2. Get all availability data for the event
        $allAvailabilityStmt = $pdo->prepare("SELECT username, slot_timestamp FROM availability WHERE event_id = ?");
        $allAvailabilityStmt->execute([$eventId]);
        $rawAllAvailability = $allAvailabilityStmt->fetchAll(PDO::FETCH_ASSOC);
        $allAvailability = []; // Processed into desired format
        foreach ($rawAllAvailability as $row) {
            $dt = new DateTime('@' . $row['slot_timestamp'], new DateTimeZone('UTC'));
            $allAvailability[] = [
                'username' => htmlspecialchars($row['username'], ENT_QUOTES, 'UTF-8'), // Apply sanitization here
                'date' => $dt->format('Y-m-d'), // UTC date
                'hour' => (int)$dt->format('G')  // UTC hour
            ];
        }

        // 3. Calculate per-slot availability counts
        $perSlotAvailabilityCounts = [];
        foreach ($allAvailability as $record) {
            $slotKey = $record['date'] . '_' . $record['hour']; // UTC key
            $perSlotAvailabilityCounts[$slotKey] = ($perSlotAvailabilityCounts[$slotKey] ?? 0) + 1;
        }

        // 4. Calculate per-slot availability percentages
        $perSlotAvailabilityPercentages = [];
        if ($totalEventUsers > 0) {
            foreach ($perSlotAvailabilityCounts as $slotKey => $count) {
                $perSlotAvailabilityPercentages[$slotKey] = round(($count / $totalEventUsers) * 100);
            }
        }

        // 5. Prepare detailed slot user information for tooltips ($slotUserDetails)
        $slotUserDetails = [];
        // Note: $eventDetails is the raw event record from the DB
        if (isset($eventDetails['start_datetime'], $eventDetails['end_datetime'])) {
            // These are stored as milliseconds in DB, convert to DateTimeImmutable
            $startDateTime = DateTimeImmutable::createFromFormat('U.u', sprintf('%.3f', $eventDetails['start_datetime'] / 1000))->setTimezone(new DateTimeZone('UTC'));
            $endDateTime = DateTimeImmutable::createFromFormat('U.u', sprintf('%.3f', $eventDetails['end_datetime'] / 1000))->setTimezone(new DateTimeZone('UTC'));

            $currentIterDateTime = $startDateTime;
            while ($currentIterDateTime < $endDateTime) { // Iterate through each hour of the event
                $dateStr = $currentIterDateTime->format('Y-m-d'); // UTC
                $hourVal = (int)$currentIterDateTime->format('G'); // UTC
                $currentSlotKey = $dateStr . '_' . $hourVal;

                $availableForSlot = [];
                foreach ($allAvailability as $avail) {
                    if ($avail['date'] === $dateStr && (int)$avail['hour'] === $hourVal) {
                        $availableForSlot[] = $avail['username'];
                    }
                }
                $availableForSlotUnique = array_values(array_unique($availableForSlot));

                $unavailableForSlot = [];
                if (!empty($eventUsers)) { // Only iterate if there are users
                    foreach ($eventUsers as $user) {
                        if (!in_array($user, $availableForSlotUnique)) {
                            $unavailableForSlot[] = $user;
                        }
                    }
                }
                $slotUserDetails[$currentSlotKey] = [
                    'available' => $availableForSlotUnique,
                    'unavailable' => $unavailableForSlot
                ];
                $currentIterDateTime = $currentIterDateTime->add(new DateInterval('PT1H'));
            }
        }

        return [
            'eventUsers' => $eventUsers,
            'totalEventUsers' => $totalEventUsers,
            'allAvailability' => $allAvailability,
            'perSlotAvailabilityCounts' => $perSlotAvailabilityCounts,
            'perSlotAvailabilityPercentages' => $perSlotAvailabilityPercentages,
            'slotUserDetails' => $slotUserDetails
            // 'startDateTime' => $startDateTime, // Optional: if needed by caller directly
            // 'endDateTime' => $endDateTime     // Optional: if needed by caller directly
        ];
    }
    // End of getEventAggregateData function


    session_set_cookie_params([
        'lifetime' => 0,
        'path' => '/',
        'domain' => '.quickbrownfoxes.org', // Current domain
        'secure' => true,
        'httponly' => true,
        'samesite' => 'Strict'
    ]);
    // Get current user from session or default
    session_start();
    if (empty($_SESSION['csrf_token'])) {
        $_SESSION['csrf_token'] = bin2hex(random_bytes(32));
    }
    $csrf_token = $_SESSION['csrf_token'];

    // AJAX Endpoint for fetching aggregate availability data
    if (isset($_GET['id']) && isset($_GET['action']) && $_GET['action'] === 'get_aggregate_data') {
        $eventId = $_GET['id'];
        header('Content-Type: application/json');

        try {
            $eventStmt = $pdo->prepare("SELECT * FROM events WHERE uniqueid = :uniqueid");
            $eventStmt->execute([':uniqueid' => $eventId]);
            $eventFromDb = $eventStmt->fetch(PDO::FETCH_ASSOC); // Renamed to avoid conflict if $event is already in scope

            if (!$eventFromDb) {
                http_response_code(404);
                echo json_encode(['status' => 'error', 'message' => 'Event not found.']);
                exit;
            }

            // Call the refactored function
            $aggregateData = getEventAggregateData($pdo, $eventId, $eventFromDb);

            echo json_encode([
                'status' => 'success',
                'perSlotAvailabilityPercentages' => $aggregateData['perSlotAvailabilityPercentages'],
                'slotUserDetails' => $aggregateData['slotUserDetails']
            ]);
            exit;
        } catch (PDOException $e) {
            error_log("Error fetching aggregate data for event $eventId: " . $e->getMessage());
            http_response_code(500);
            echo json_encode(['status' => 'error', 'message' => 'Database error occurred while fetching aggregate data.']);
            exit;
        } catch (Exception $e) {
            error_log("Error fetching aggregate data for event $eventId: " . $e->getMessage());
            http_response_code(500);
            echo json_encode(['status' => 'error', 'message' => 'An unexpected error occurred while fetching aggregate data.']);
            exit;
        }
    }
    // End of AJAX Endpoint for aggregate data

    // The check for $_GET['id'] is important for normal operation.
    // It should not conflict with the cleanup logic as cleanup doesn't rely on $_GET['id'] and doesn't echo/exit.
    if ($_SERVER['REQUEST_METHOD'] !== 'POST' && !isset($_GET['id'])) {
        header('Location: .#noevent');
        exit;
    }
    $currentUser = isset($_SESSION['user_' . $_GET['id']]) ? $_SESSION['user_' . $_GET['id']] : 'User_Undefined1951';
    $overallAvailabilityPercentage = 0;

    // Handle user change
    if (isset($_POST['user']) && !empty($_POST['user']) && ($_POST['user'] != 'User_Undefined1951')) {
        if (!isset($_POST['csrf_token']) || !hash_equals($_SESSION['csrf_token'], $_POST['csrf_token'])) {
            die('CSRF token validation failed');
        }
        $trimUser = strtolower(trim($_POST['user']));
        $truncUser = mb_substr($trimUser, 0, 32, 'UTF-8');
        $newUser = $truncUser;
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
        $is_ajax_request = !empty($_SERVER['HTTP_X_REQUESTED_WITH']) && strtolower($_SERVER['HTTP_X_REQUESTED_WITH']) == 'xmlhttprequest';

        if (!isset($_POST['csrf_token']) || !hash_equals($_SESSION['csrf_token'], $_POST['csrf_token'])) {
            if ($is_ajax_request) {
                header('Content-Type: application/json');
                echo json_encode(['status' => 'error', 'message' => 'CSRF token validation failed']);
                exit;
            } else {
                die('CSRF token validation failed');
            }
        }
        $eventId = $_GET['id'];
        $username = $currentUser; // Use $currentUser

        try {
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
                        // Create DateTime object in UTC and get timestamp.
                        // DateTime constructor can throw an Exception on invalid input.
                        $dt = new DateTime($datePart . ' ' . $hourPart . ':00:00', new DateTimeZone('UTC'));
                        $slot_timestamp = $dt->getTimestamp();
                        $insertStmt->execute([$eventId, $username, $slot_timestamp]);
                    }
                }
            }

            // If we reach here, database operations were successful.
            if ($is_ajax_request) {
                header('Content-Type: application/json');
                echo json_encode(['status' => 'success', 'message' => 'Availability saved successfully.']);
                exit;
            } else {
                header("Location: ?id=" . $eventId);
                exit;
            }
        } catch (PDOException $e) {
            if ($is_ajax_request) {
                header('Content-Type: application/json');
                error_log("PDOException during availability save for event $eventId by $username: " . $e->getMessage());
                echo json_encode(['status' => 'error', 'message' => 'A database error occurred while saving availability.']);
                exit;
            } else {
                // For non-AJAX, let the main error handler at the bottom of the script catch it.
                throw $e;
            }
        } catch (Exception $e) { // Catch other general exceptions, e.g., from DateTime creation
            if ($is_ajax_request) {
                header('Content-Type: application/json');
                error_log("Exception during availability save for event $eventId by $username: " . $e->getMessage());
                echo json_encode(['status' => 'error', 'message' => 'An unexpected error occurred while processing availability data.']);
                exit;
            } else {
                // For non-AJAX, let the main error handler at the bottom of the script catch it.
                throw $e;
            }
        }
    }

    // First check if the event exists
    $checkStmt = $pdo->prepare("SELECT * FROM events WHERE uniqueid = :uniqueid");
    $checkStmt->execute([':uniqueid' => $_GET['id']]);
    $event = $checkStmt->fetch(PDO::FETCH_ASSOC);

    if (!$event) { // Event does not exist (if $_GET['id'] was provided), OR $_GET['id'] was not provided (new event creation path from index.html)

        // This block handles new event creation if it's a POST request, typically from index.html
        // (where $_GET['id'] would not be set, thus $event would be initially false).
        if ($_SERVER['REQUEST_METHOD'] === 'POST' && !isset($_GET['id'])) {

            // Check for necessary fields for creation from POST data
            if (
                empty($_POST) ||
                !isset($_POST['uniqueid']) ||
                !isset($_POST['event-name']) ||
                !isset($_POST['start-datetime-utc']) ||
                !isset($_POST['end-datetime-utc'])
            ) {
                error_log("Event Creation Failed: Missing required POST data. Received: " . print_r($_POST, true));
                header('Location: .#noevent&error=missing_data');
                exit;
            }

            // Validate uniqueid
            $uniqueIdToCreate = trim($_POST['uniqueid']);
            if (empty($uniqueIdToCreate) || strlen($uniqueIdToCreate) > 255) {
                error_log("Event Creation Failed: Invalid uniqueid provided. Value: '" . $uniqueIdToCreate . "' Length: " . strlen($uniqueIdToCreate));
                header('Location: .#noevent&error=invalid_id_format');
                exit;
            }
            // Example: Optional character set validation for uniqueid
            // if (!preg_match('/^[a-zA-Z0-9_-]+$/', $uniqueIdToCreate)) {
            //    error_log("Event Creation Failed: uniqueid contains invalid characters. Value: '" . $uniqueIdToCreate . "'");
            //    header('Location: .#noevent&error=invalid_id_chars');
            //    exit;
            // }

            // Validate event name
            $eventNameToCreate = trim($_POST['event-name']);
            if (empty($eventNameToCreate) || strlen($eventNameToCreate) > 255) {
                error_log("Event Creation Failed: Invalid event name for id '" . $uniqueIdToCreate . "'. Name: '" . $eventNameToCreate . "' Length: " . strlen($eventNameToCreate));
                header('Location: .#noevent&error=invalid_name_format');
                exit;
            }

            // Validate datetime fields (ensure they are strings composed of digits only)
            // Also check if they are plausible timestamps (e.g. not negative, not excessively large if needed)
            $startDatetimeUtc = $_POST['start-datetime-utc'];
            $endDatetimeUtc = $_POST['end-datetime-utc'];

            if (!ctype_digit((string)$startDatetimeUtc) || !ctype_digit((string)$endDatetimeUtc)) {
                error_log("Event Creation Failed: Invalid datetime format (not ctype_digit) for id '" . $uniqueIdToCreate . "'. Start: '" . $startDatetimeUtc . "', End: '" . $endDatetimeUtc . "'");
                header('Location: .#noevent&error=invalid_datetime_format');
                exit;
            }

            // Additional check: ensure start_datetime is before end_datetime
            // Timestamps are in milliseconds.
            if ((float)$startDatetimeUtc >= (float)$endDatetimeUtc) {
                error_log("Event Creation Failed: Start datetime must be before end datetime for id '" . $uniqueIdToCreate . "'. Start: '" . $startDatetimeUtc . "', End: '" . $endDatetimeUtc . "'");
                header('Location: .#noevent&error=invalid_datetime_order');
                exit;
            }

            // If all validations pass, proceed with insertion
            $stmt = $pdo->prepare("INSERT INTO events(event_name, uniqueid, start_datetime, end_datetime) 
                            VALUES(:event_name, :uniqueid, :start_datetime, :end_datetime)");
            try {
                $stmt->execute([
                    ':uniqueid' => $uniqueIdToCreate,
                    ':event_name' => $eventNameToCreate,
                    ':start_datetime' => $startDatetimeUtc, // Use validated variable
                    ':end_datetime' => $endDatetimeUtc    // Use validated variable
                ]);
                // Redirect to the newly created event page using GET request
                header("Location: ?id=" . urlencode($uniqueIdToCreate));
                exit;
            } catch (PDOException $e) {
                if ($e->getCode() == 23000) { // SQLSTATE 23000: Integrity constraint violation (e.g., uniqueid already exists)
                    error_log("Event Creation Failed: uniqueid already exists - '" . $uniqueIdToCreate . "'. Error: " . $e->getMessage());
                    // It's possible the client generated an ID that, by chance, already exists.
                    header('Location: .#noevent&error=event_id_taken');
                    exit;
                } else {
                    error_log("Event Creation Failed: Database error for id '" . $uniqueIdToCreate . "'. Error: " . $e->getMessage());
                    header('Location: .#noevent&error=db_error_creation');
                    exit;
                }
            }
        } else {
            // This path is taken if:
            // 1. $_GET['id'] was set, but no event with that ID was found by the initial query.
            // 2. It's not a POST request for creation (e.g., a GET request with no ID, or a GET with an ID that wasn't found).
            if (isset($_GET['id'])) {
                error_log("Event Not Found: No event with ID '" . $_GET['id'] . "' found via GET.");
                header('Location: .#noevent&error=event_not_found_get');
            } else {
                // Generic case if somehow reached without a GET ID and not a POST for creation.
                // This might happen if the initial `if (!isset($_GET['id']))` (around L260) was bypassed or conditions change.
                error_log("Event Logic Error: Reached creation/lookup path without GET ID and not a valid POST creation request.");
                header('Location: .#noevent&error=invalid_access');
            }
            exit;
        }
    }

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

    // Fetch aggregate data using the new function
    // $event variable should already be fetched and checked before this point (around line 217 in original)
    $aggregateData = getEventAggregateData($pdo, $_GET['id'], $event);
    $eventUsers = $aggregateData['eventUsers'];
    $totalEventUsers = $aggregateData['totalEventUsers'];
    $allAvailability = $aggregateData['allAvailability']; // This is the processed version
    // $perSlotAvailabilityCounts = $aggregateData['perSlotAvailabilityCounts']; // If needed
    $perSlotAvailabilityPercentages = $aggregateData['perSlotAvailabilityPercentages'];
    $slotUserDetails = $aggregateData['slotUserDetails'];


    // Calculate Overall Availability Percentage
    // This calculation might also be moved into getEventAggregateData or a similar helper
    // if $startDateTime and $endDateTime (DateTimeImmutable objects) are consistently derived there.
    // For now, it re-uses $allAvailability from the aggregateData and $event (for start/end times)
    if ($event && isset($event['start_datetime'], $event['end_datetime'])) {
        // These DateTimeImmutable objects are now created inside getEventAggregateData if needed for slotUserDetails.
        // To avoid re-creating them, getEventAggregateData could return them, or this logic also moves.
        // For minimal changes here, we re-create them or assume they might be created if Overall Availability % is complex.
        // However, the $allAvailability needed is already processed (UTC date/hour strings).

        // Re-derive $startDateTime and $endDateTime for this specific calculation block if not returned by getEventAggregateData
        $startDateTimeForOverall = DateTimeImmutable::createFromFormat('U.u', sprintf('%.3f', $event['start_datetime'] / 1000))->setTimezone(new DateTimeZone('UTC'));
        $endDateTimeForOverall = DateTimeImmutable::createFromFormat('U.u', sprintf('%.3f', $event['end_datetime'] / 1000))->setTimezone(new DateTimeZone('UTC'));

        $possibleSlots = [];
        $currentIterDateTime = $startDateTimeForOverall;
        while ($currentIterDateTime < $endDateTimeForOverall) {
            $possibleSlots[$currentIterDateTime->format('Y-m-d_G')] = true; // Use keys for uniqueness
            $currentIterDateTime = $currentIterDateTime->add(new DateInterval('PT1H'));
        }
        $totalPossibleSlots = count($possibleSlots);

        $uniqueAvailableSlotsSet = [];
        // $allAvailability is now the processed one from getEventAggregateData
        foreach ($allAvailability as $avail) {
            $uniqueAvailableSlotsSet[$avail['date'] . '_' . $avail['hour']] = true; // Use keys for uniqueness
        }
        $uniqueAvailableSlots = count($uniqueAvailableSlotsSet);

        if ($totalPossibleSlots > 0) {
            $overallAvailabilityPercentage = round(($uniqueAvailableSlots / $totalPossibleSlots) * 100);
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
// Sanitize event fields before outputting to JSON
if ($event) {
    $event['event_name'] = htmlspecialchars($event['event_name'], ENT_QUOTES, 'UTF-8');
}
?>

<!DOCTYPE html>
<html lang="en">

<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <meta name="gitlab-dast-validation" content="059797f5-753a-48b7-80a6-3de722cda1a5">
    <link rel="shortcut icon" href="https://cdn.quickbrownfoxes.org/originalsq%2032.png" />
    <meta property="og:image" content="https://cdn.quickbrownfoxes.org/originalsq%2032.png" />
    <meta property="og:type" content="website" />
    <meta property="og:title" content="Event scheduler" />
    <meta property="og:description" content="Easy to use, mobile friendly event scheduler for groups!" />
    <title><?php echo htmlspecialchars($event["event_name"]); ?></title>
    <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/bootstrap/5.3.3/css/bootstrap.min.css" integrity="sha512-jnSuA4Ss2PkkikSOLtYs8BlYIeeIK1h99ty4YfvRPAlzr377vr3CXDb7sb7eEEBYjDtcYj+AjBH3FLv5uSJuXg==" crossorigin="anonymous" referrerpolicy="no-referrer" />
    <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/jqueryui/1.14.1/themes/base/theme.min.css" integrity="sha512-lfR3NT1DltR5o7HyoeYWngQbo6Ec4ITaZuIw6oAxIiCNYu22U5kpwHy9wAaN0vvBj3U6Uy2NNtAfiaKcDxfhTg==" crossorigin="anonymous" referrerpolicy="no-referrer" />
    <link rel="stylesheet" href="style.css">
    <script>
        <?php
        // Consolidate all PHP data into a single JavaScript object
        echo 'window.eventAppData = ' . json_encode([
            'event' => $event, // Assumes $event['event_name'] is already sanitized if necessary before this point
            'userAvailability' => $userAvailability,
            'perSlotAvailabilityPercentages' => $perSlotAvailabilityPercentages,
            'slotUserDetails' => $slotUserDetails,
            'csrfToken' => $csrf_token
        ]) . ';';
        ?>
        // Optional: console.log(window.eventAppData); // For debugging initial data
    </script>
</head>
<div class="container-fluid my-2">
    <div class="row justify-content-between">
        <div class="col-md-4">
            <h1><?php echo htmlspecialchars($event["event_name"]); ?></h1>
        </div>
        <div class="col-md-6 d-flex justify-content-end">
            <div id="event-meta"></div>
        </div>
    </div>
    <div class="row justify-content-between">
        <div class="col-md-4">
            <div class="h6 mt-2">Current User: <?php echo htmlspecialchars($currentUser); ?><br /> <a href="#user" data-bs-toggle="modal">Switch User</a></div>
        </div>
        <div class="col-md-2 mb-2">
            <a href="#"><button type="button" class="btn btn-info" id="toggle-select-mode">In Select Mode</button></a>
        </div>
        <div class="col-md-6 d-flex justify-content-end gap-2">
            <a href="."><button type="button" class="btn btn-outline-primary">New Event</button></a>
            <a href="#"><button type="button" id="copy-link" class="btn btn-primary" url-site="">Share event</button>
            </a>
            <a href="#">
                <span id="selected-slots-container"></span>
                <button id="save-state" class="btn btn-success" disabled>Saved ✔</button>
            </a>
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
                <h5 class="modal-title" id="userModalLabel">Who are you? (Case insensitive)</h5>
            </div>
            <div class="modal-body">
                <form id="changeuser" action="?id=<?php echo htmlspecialchars($event["uniqueid"]); ?>" method="post">
                    <input type="hidden" name="csrf_token" value="<?php echo htmlspecialchars($csrf_token); ?>">
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
<script src="https://cdnjs.cloudflare.com/ajax/libs/darkreader/4.9.105/darkreader.min.js" integrity="sha512-sEhLAzpUW+e8uZdmsepVQqJDtsYT8mJ8XtBhb9rq3nEZxrAlaKzWI2qSWul2HHxJodPANXAx1MNxuba+Sv9yew==" crossorigin="anonymous" referrerpolicy="no-referrer"></script>
<script defer src='https://static.cloudflareinsights.com/beacon.min.js' data-cf-beacon='{"token": "8dd677a97b1d45aaab4f33a4b78eb87d"}'></script><!-- End Cloudflare Web Analytics -->
<script>DarkReader.auto();</script>
</html>