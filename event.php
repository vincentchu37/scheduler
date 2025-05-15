<?php
// Connect to SQLite database
try {
    $pdo = new PDO('sqlite:events.db');
    $pdo->setAttribute(PDO::ATTR_ERRMODE, PDO::ERRMODE_EXCEPTION);

    // Create table if not exists
    $pdo->exec("CREATE TABLE IF NOT EXISTS events(
        uniqueid VARCHAR(255) PRIMARY KEY,
        event_name VARCHAR(255),
        start_datetime INTEGER,
        end_datetime INTEGER
    )");

    // First check if the ID already exists
    $checkStmt = $pdo->prepare("SELECT * FROM events WHERE uniqueid = :uniqueid");
    $checkStmt->execute([':uniqueid' => $_GET['id']]);

    $event = $checkStmt->fetch(PDO::FETCH_ASSOC);

    if (!$event) {
        if (empty($_POST)) {
            echo "No event with this ID.";
            header('Location: .#noevent');
            die;
        }
        // Prepare and execute insert statement
        $stmt = $pdo->prepare("INSERT INTO events(event_name, uniqueid, start_datetime, end_datetime) 
                        VALUES(:event_name, :uniqueid, :start_datetime, :end_datetime)");

        $stmt->execute([
            ':uniqueid' => $_POST['uniqueid'],
            ':event_name' => $_POST['event-name'],
            ':start_datetime' => $_POST['start-datetime-utc'],
            ':end_datetime' => $_POST['end-datetime-utc']
        ]);

        header("Refresh:0");
    }

    if (isset($_POST['user'])) {

    }
    

} catch (PDOException $e) {
    if ($e->getCode() == 23000) { // Integrity constraint violation
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
    <title>Event</title>
    <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/bootstrap/5.3.3/css/bootstrap.min.css" integrity="sha512-jnSuA4Ss2PkkikSOLtYs8BlYIeeIK1h99ty4YfvRPAlzr377vr3CXDb7sb7eEEBYjDtcYj+AjBH3FLv5uSJuXg==" crossorigin="anonymous" referrerpolicy="no-referrer" />
    <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/jqueryui/1.14.1/themes/base/theme.min.css" integrity="sha512-lfR3NT1DltR5o7HyoeYWngQbo6Ec4ITaZuIw6oAxIiCNYu22U5kpwHy9wAaN0vvBj3U6Uy2NNtAfiaKcDxfhTg==" crossorigin="anonymous" referrerpolicy="no-referrer" />
    <link rel="stylesheet" href="style.css">
    <script>
        // Make $_POST data available as a global JavaScript object
        var data = <?php echo json_encode($event); ?>;
    </script>
</head>
<span class="float-end"></span>
<div class="container-fluid my-2">
    <h1 class="text-center"><?php echo $event["event_name"]; ?></h1>
    <div class="row">
        <div class="col-md-3 d-grid mb-3">
            <div class="h6 mt-2">Current User: jflkdsjaklfjdlskafjdlksja</div>
        </div>
        <div class="col-md-3 d-grid mb-3">
            <form id="changeuser" action="?id=<?php echo $event["uniqueid"]; ?>&change=1" method="post">
                <span class="input-group">
                    <input type="text" id="user" class="form-control" placeholder="User" name="user">
                    <button class="btn btn-outline-secondary" type="submit" id="changeuser">Switch User</button>
                </span>
            </form>
        </div>
        <div class="col-md-3 d-grid mb-3">
            <button type="button" id="copy-link" class="btn btn-outline-primary link-copy"
                url-site="<?php echo "https://$_SERVER[HTTP_HOST]$_SERVER[REQUEST_URI]"; ?>"
                data-bs-original-title="Copy URL">
                <i class="bi-share-fill"></i> Share this with others
            </button>
        </div>
        <div class="col-md-3 d-grid mb-3">
            <form id="save-availability" action="?id=<?php echo $event["uniqueid"]; ?>&save=1" method="post">
                <button type="submit" id="save-availability" class="btn btn-success">Save My Availability</button>
            </form>
        </div>
    </div>
    <!-- Calendar Container -->
    <div class="calendar-container" id="calendar-grid"></div>

</div>


<script>
    document.addEventListener('DOMContentLoaded', function() {
        const userTimeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
        const select = document.getElementById('timezone');
        if (select && userTimeZone) {
            select.value = userTimeZone;
        }
    });
</script>

<script src="https://cdnjs.cloudflare.com/ajax/libs/jquery/3.7.1/jquery.min.js" integrity="sha512-v2CJ7UaYy4JwqLDIrZUI/4hqeoQieOmAZNXBeQyjo21dadnwR+8ZaIJVT8EE2iyI61OV8e6M8PP2/4hpQINQ/g==" crossorigin="anonymous" referrerpolicy="no-referrer"></script>
<script src="https://cdnjs.cloudflare.com/ajax/libs/jqueryui/1.14.1/jquery-ui.min.js" integrity="sha512-MSOo1aY+3pXCOCdGAYoBZ6YGI0aragoQsg1mKKBHXCYPIWxamwOE7Drh+N5CPgGI5SA9IEKJiPjdfqWFWmZtRA==" crossorigin="anonymous" referrerpolicy="no-referrer"></script>
<script src="https://cdnjs.cloudflare.com/ajax/libs/bootstrap/5.3.3/js/bootstrap.bundle.min.js" integrity="sha512-7Pi/otdlbbCR+LnW+F7PwFcSDJOuUJB3OxtEHbg4vSMvzvJjde4Po1v4BR9Gdc9aXNUNFVUY+SK51wWT8WF0Gg==" crossorigin="anonymous" referrerpolicy="no-referrer"></script>
<script src="cal.js"></script>

</html>