import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// This function runs on a cron schedule (every hour).
// It finds bookings happening ~24 hours from now and sends reminder emails,
// using reminder_log to ensure each booking only gets one reminder.

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function formatDateLong(dateStr: string): string {
  const d = new Date(dateStr + "T00:00:00");
  return d.toLocaleDateString("en-US", {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}

function formatTime12(time24: string): string {
  const [h, m] = time24.split(":").map(Number);
  const ampm = h >= 12 ? "PM" : "AM";
  const hour = h % 12 || 12;
  return `${hour}:${m.toString().padStart(2, "0")} ${ampm}`;
}

function addMinutesToTime(time24: string, minutes: number): string {
  const [h, m] = time24.split(":").map(Number);
  const total = h * 60 + m + minutes;
  const newH = Math.floor(total / 60) % 24;
  const newM = total % 60;
  return `${newH.toString().padStart(2, "0")}:${newM.toString().padStart(2, "0")}`;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const supabaseAdmin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const resendKey = Deno.env.get("RESEND_API_KEY")!;

    // Calculate the target: 24 hours from now, rounded to the current hour
    // e.g. if it's currently 2:47 PM, we look for bookings tomorrow at 2:xx PM
    const now = new Date();
    const target = new Date(now.getTime() + 24 * 60 * 60 * 1000);

    const targetDate = target.toISOString().split("T")[0]; // "YYYY-MM-DD"
    const targetHour = target.getHours().toString().padStart(2, "0"); // "14"

    // Find bookings at that hour tomorrow that haven't been reminded yet
    // We use a left join pattern: fetch bookings then filter out ones in reminder_log
    const { data: bookings, error: fetchError } = await supabaseAdmin
      .from("bookings")
      .select(`
        id,
        student_name,
        email,
        booking_date,
        booking_time,
        is_admin_block,
        reminder_log (booking_id)
      `)
      .eq("booking_date", targetDate)
      .like("booking_time", `${targetHour}:%`)
      .eq("is_admin_block", false);

    if (fetchError) throw fetchError;

    if (!bookings || bookings.length === 0) {
      return new Response(
        JSON.stringify({ success: true, reminded: 0, message: "No bookings in target window" }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Filter to only bookings that have NOT been reminded yet
    const toRemind = bookings.filter(
      (b) => !b.reminder_log || (b.reminder_log as unknown[]).length === 0
    );

    let remindedCount = 0;

    for (const booking of toRemind) {
      if (!booking.email || booking.email === "N/A") continue;

      const formattedDate = formatDateLong(booking.booking_date);
      const startTime = booking.booking_time.slice(0, 5);
      const endTime = addMinutesToTime(startTime, 30);
      const formattedStart = formatTime12(startTime);
      const formattedEnd = formatTime12(endTime);

      const emailPayload = {
        from: "Office Hours <officehours@tv-mexico.com>",
        to: [booking.email],
        subject: `Reminder: Office Hours Tomorrow — ${formattedDate}`,
        html: `
          <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto;">
            <h2 style="color: #2d3748;">Office hours reminder 🔔</h2>
            <p>Hi ${booking.student_name},</p>
            <p>This is a reminder that you have an office hours appointment <strong>tomorrow</strong>:</p>
            <table style="border-collapse: collapse; width: 100%; margin: 20px 0;">
              <tr><td style="padding: 8px; font-weight: bold; width: 120px;">Date</td><td style="padding: 8px;">${formattedDate}</td></tr>
              <tr style="background:#f7fafc;"><td style="padding: 8px; font-weight: bold;">Time</td><td style="padding: 8px;">${formattedStart} – ${formattedEnd}</td></tr>
              <tr><td style="padding: 8px; font-weight: bold;">Location</td><td style="padding: 8px;">CCOB 42-125</td></tr>
            </table>
            <p style="background: #ebf8ff; border-left: 4px solid #3182ce; padding: 12px; border-radius: 4px;">
              If you need to cancel, please do so now so another student can take your slot.
              Contact Prof. Waterman at <a href="mailto:paul.waterman@gcu.edu">paul.waterman@gcu.edu</a>.
            </p>
            <p style="color: #718096; font-size: 0.9em;">Waterman Office Hours · CCOB 42-125 · Grand Canyon University</p>
          </div>
        `,
      };

      const emailRes = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${resendKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(emailPayload),
      });

      if (emailRes.ok) {
        // Log that the reminder was sent — UNIQUE constraint prevents duplicates
        await supabaseAdmin
          .from("reminder_log")
          .insert({ booking_id: booking.id })
          .select(); // ignore conflicts silently

        remindedCount++;
      } else {
        console.error(`Failed to send reminder for booking ${booking.id}:`, await emailRes.text());
      }
    }

    return new Response(
      JSON.stringify({ success: true, reminded: remindedCount, checked: toRemind.length }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );

  } catch (err) {
    console.error("send-24h-reminders error:", err);
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
