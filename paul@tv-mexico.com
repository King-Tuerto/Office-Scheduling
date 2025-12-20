<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Admin Panel - Office Hours</title>
    <!-- Official working Supabase CDN for v2 (latest) -->
    <script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2"></script>
    <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, Cantarell, sans-serif;
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            min-height: 100vh;
            padding: 20px;
        }
        .login-container {
            max-width: 400px;
            margin: 100px auto;
            background: white;
            padding: 40px;
            border-radius: 12px;
            box-shadow: 0 20px 60px rgba(0,0,0,0.3);
        }
        .container {
            max-width: 1200px;
            margin: 0 auto;
            background: white;
            border-radius: 12px;
            box-shadow: 0 20px 60px rgba(0,0,0,0.3);
            padding: 30px;
        }
        h1 { color: #2d3748; margin-bottom: 10px; font-size: 2em; }
        h2 { color: #2d3748; margin-bottom: 20px; font-size: 1.5em; }
        h3 { color: #2d3748; margin-bottom: 15px; font-size: 1.2em; }
        .date-header { color: #2d3748; margin-bottom: 15px; font-size: 1.2em; font-weight: 600; }
        .subtitle { color: #718096; margin-bottom: 25px; }
        .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(400px, 1fr)); gap: 20px; margin-bottom: 30px; }
        .card {
            border: 2px solid #e2e8f0;
            border-radius: 8px;
            padding: 20px;
            background: #f7fafc;
        }
        .form-group { margin-bottom: 15px; }
        label { display: block; font-weight: 600; margin-bottom: 6px; color: #2d3748; font-size: 14px; }
        input, select {
            width: 100%;
            padding: 10px;
            border: 2px solid #e2e8f0;
            border-radius: 6px;
            font-size: 15px;
        }
        input:focus, select:focus {
            outline: none;
            border-color: #667eea;
        }
        .time-row { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
        .btn {
            width: 100%;
            padding: 12px;
            border: none;
            border-radius: 6px;
            font-size: 15px;
            font-weight: 600;
            cursor: pointer;
            transition: all 0.3s;
        }
        .btn-primary {
            background: #667eea;
            color: white;
        }
        .btn-primary:hover { background: #5a67d8; }
        .btn-success {
            background: #48bb78;
            color: white;
        }
        .btn-success:hover { background: #38a169; }
        .btn-warning {
            background: #ed8936;
            color: white;
        }
        .btn-warning:hover { background: #dd6b20; }
        .btn-danger {
            background: #fc8181;
            color: white;
            padding: 8px 16px;
            font-size: 14px;
        }
        .btn-danger:hover { background: #f56565; }
        .bookings-list {
            margin-top: 20px;
        }
        .booking-card {
            background: white;
            border: 1px solid #e2e8f0;
            border-radius: 8px;
            padding: 15px;
            margin-bottom: 12px;
            display: flex;
            justify-content: space-between;
            align-items: center;
        }
        .booking-info strong {
            color: #2d3748;
            display: block;
            margin-bottom: 5px;
        }
        .booking-info small {
            color: #718096;
            display: block;
            line-height: 1.5;
        }
        .email-link {
            color: #667eea;
            text-decoration: none;
            font-weight: 500;
        }
        .email-link:hover {
            text-decoration: underline;
        }
        .success-msg, .error-msg {
            padding: 12px;
            border-radius: 6px;
            margin-bottom: 20px;
        }
        .success-msg {
            background: #c6f6d5;
            color: #22543d;
            border: 1px solid #9ae6b4;
        }
        .error-msg {
            background: #fed7d7;
            color: #742a2a;
            border: 1px solid #fc8181;
        }
        .logout-btn {
            float: right;
            background: #718096;
            color: white;
            padding: 8px 16px;
            border: none;
            border-radius: 4px;
            cursor: pointer;
            font-size: 14px;
        }
        .logout-btn:hover { background: #4a5568; }
        .slots-list {
            max-height: 300px;
            overflow-y: auto;
        }
        .slot-card {
            background: white;
            border: 1px solid #e2e8f0;
            border-radius: 6px;
            padding: 12px;
            margin-bottom: 8px;
            display: flex;
            justify-content: space-between;
            align-items: center;
        }
        .delete-slot-btn {
            background: #fc8181;
            color: white;
            padding: 6px 12px;
            border: none;
            border-radius: 4px;
            cursor: pointer;
            font-size: 13px;
        }
        .delete-slot-btn:hover { background: #f56565; }
        #confirmModal {
            display: none;
            position: fixed;
            background: white;
            padding: 20px;
            border-radius: 8px;
            box-shadow: 0 10px 30px rgba(0,0,0,0.3);
            z-index: 1000;
            max-width: 400px;
            text-align: center;
        }
        #confirmModal .btn {
            width: auto;
            display: inline-block;
            margin: 0 5px;
        }
        #confirmModal #confirmNo {
            background: #718096;
            color: white;
        }
        #confirmModal #confirmNo:hover {
            background: #4a5568;
        }
    </style>
</head>
<body>
    <div id="loginScreen" class="login-container">
        <h2 style="text-align: center; margin-bottom: 30px;">Admin Login</h2>
        <div class="form-group">
            <label>Access Code</label>
            <input type="password" id="accessCode" placeholder="Enter admin code">
        </div>
        <button onclick="login()" class="btn btn-primary">Login</button>
        <div id="loginError" style="display: none; margin-top: 15px;"></div>
    </div>

    <div id="adminPanel" style="display: none;">
        <div class="container">
            <button class="logout-btn" onclick="logout()">Logout</button>
            <h1>Admin Panel</h1>
            <p class="subtitle">Manage your office hours and bookings</p>

            <div id="message"></div>

            <div class="grid">
                <div class="card">
                    <h3>Add Available Time Block</h3>
                    <div class="form-group">
                        <label>Date</label>
                        <input type="date" id="slotDate">
                    </div>
                    <div class="time-row">
                        <div class="form-group">
                            <label>Start Time</label>
                            <input type="time" id="startTime">
                        </div>
                        <div class="form-group">
                            <label>End Time</label>
                            <input type="time" id="endTime">
                        </div>
                    </div>
                    <button onclick="addTimeBlock()" class="btn btn-success">Add Time Block</button>
                    
                    <div class="slots-list" id="slotsList" style="margin-top: 20px;"></div>
                </div>

                <div class="card">
                    <h3>Block Time Range for Myself</h3>
                    <div class="form-group">
                        <label>Date</label>
                        <input type="date" id="blockDate">
                    </div>
                    <div class="time-row">
                        <div class="form-group">
                            <label>Start Time</label>
                            <input type="time" id="blockStartTime">
                        </div>
                        <div class="form-group">
                            <label>End Time</label>
                            <input type="time" id="blockEndTime">
                        </div>
                    </div>
                    <div class="form-group">
                        <label>
                            <input type="checkbox" id="outOfOffice"> Out of Office
                        </label>
                    </div>
                    <button onclick="blockTimeRange()" class="btn btn-warning">Block This Range</button>
                </div>
            </div>

            <div class="card">
                <h3>All Bookings</h3>
                <div class="bookings-list" id="bookingsList"></div>
            </div>
        </div>
    </div>

    <div id="confirmModal">
        <p id="confirmText">Are you sure?</p>
        <div style="text-align: right; margin-top: 15px;">
            <button id="confirmNo" class="btn">No</button>
            <button id="confirmYes" class="btn btn-danger">Yes</button>
        </div>
    </div>

    <script>
        const SUPABASE_URL = 'https://vlbgfdabkmaykwzkidom.supabase.co';
        const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InZsYmdmZGFia21heWt3emtpZG9tIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTk2MDU2MzIsImV4cCI6MjA3NTE4MTYzMn0.ZW8myPbVweQruU6jyV59dCbYZQlXKZ_RpFipe4hQGkw';
        
        // New way to create the client with current Supabase CDN
        const { createClient } = supabase;
        const client = createClient(SUPABASE_URL, SUPABASE_KEY);
        
        const ADMIN_CODE = '3912';

        let currentConfirmAction = null;
        let currentConfirmButton = null;

        function add30min(timeStr) {
            const [hours, minutes] = timeStr.split(':').map(Number);
            let newMinutes = minutes + 30;
            let newHours = hours;
            if (newMinutes >= 60) {
                newMinutes -= 60;
                newHours = (hours + 1) % 24;
            }
            return `${newHours.toString().padStart(2, '0')}:${newMinutes.toString().padStart(2, '0')}`;
        }

        function showConfirm(message, action, button = null) {
            document.getElementById('confirmText').textContent = message;
            currentConfirmAction = action;
            currentConfirmButton = button;
            const modal = document.getElementById('confirmModal');
            modal.style.display = 'block';

            if (button) {
                const rect = button.getBoundingClientRect();
                setTimeout(() => {
                    const modalRect = modal.getBoundingClientRect();
                    const buttonRect = button.getBoundingClientRect();
                    const top = buttonRect.top - modalRect.height - 5;
                    const left = buttonRect.left - 150;
                    modal.style.top = top
