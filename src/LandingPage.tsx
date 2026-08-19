// What the root path serves now that no URL resolves to a survey implicitly.
//
// The point of this page is what it does NOT do: it never mounts App, so
// nothing here records a session. Every visit that used to land on the main
// survey — the bare domain, a typo, a crawler — arrives here instead and leaves
// the statistics untouched.

export default function LandingPage() {
  return (
    <div className="app">
      <main className="card">
        <div className="screen center">
          <h1>E.D.E.A</h1>
          <p className="help">
            כאן מתארחים שאלוני המחקר של E.D.E.A. אין בכתובת הזו שאלון פתוח — כל שאלון נפתח
            מקישור ייעודי שנשלח למשתתפים.
          </p>
          <p className="help">אם קיבלתם קישור והגעתם לכאן, כדאי לבדוק אותו מול מי ששלח אותו.</p>
        </div>
      </main>
    </div>
  );
}
