// Proof that the person at this Mac asked for it: macOS LocalAuthentication,
// passed only with Touch ID or the login password.
// Not an osascript dialog: anything that can drive the screen could click one;
// a fingerprint or password is something no program can supply.
// Usage: /usr/bin/swift human-gate.swift "<reason shown to you>" [timeout seconds, default 45]
// Last line of output: GATE_OK (exit 0) | GATE_DENIED <why> (exit 1, includes cancel)
//                      | GATE_TIMEOUT (exit 2) | GATE_UNAVAILABLE <why> (exit 3)
import Foundation
import LocalAuthentication

let args = CommandLine.arguments
let reason = args.count > 1 ? args[1] : "myoffice needs to confirm it is you"
let timeoutSec = args.count > 2 ? (Double(args[2]) ?? 45) : 45

let ctx = LAContext()
var probeErr: NSError?
guard ctx.canEvaluatePolicy(.deviceOwnerAuthentication, error: &probeErr) else {
    print("GATE_UNAVAILABLE \(probeErr?.localizedDescription ?? "unknown")")
    exit(3)
}
let sem = DispatchSemaphore(value: 0)
var passed = false
var why = ""
ctx.evaluatePolicy(.deviceOwnerAuthentication, localizedReason: reason) { ok, err in
    passed = ok
    why = err?.localizedDescription ?? ""
    sem.signal()
}
if sem.wait(timeout: .now() + timeoutSec) == .timedOut {
    ctx.invalidate()
    print("GATE_TIMEOUT")
    exit(2)
}
if passed { print("GATE_OK"); exit(0) }
print("GATE_DENIED \(why)")
exit(1)
