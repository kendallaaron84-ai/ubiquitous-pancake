import subprocess
import urllib.request
import json
import sys
import os

PROJECT_ID = os.environ.get("GCP_PROJECT", "author-jubilee-command-center")
PROJECT_NUMBER = os.environ.get("GCP_PROJECT_NUMBER", "400566266819")
GATEWAY_SA = f"wordpress-egress-gateway@{PROJECT_ID}.iam.gserviceaccount.com"
GW_MEMBER = f"serviceAccount:{GATEWAY_SA}"
EXPECTED_GATEWAY_IMAGE_DIGEST = "sha256:17c9bbbbe81b800d04781e09e324df21706b03d27403d6035d1147827baf687d"
EXPECTED_GATEWAY_REVISION = "wordpress-egress-gateway-prod-00012-bih"
EXPECTED_NUMERIC_CEL = f'resource.name.startsWith("projects/{PROJECT_NUMBER}/secrets/WP_CREDS_")'
EXPECTED_CUSTOM_ROLE = f"projects/{PROJECT_ID}/roles/wordpressSecretCreator"

# Canonical expected Cloud Run service inventory in us-central1
EXPECTED_SERVICES = {
    "asset-provisioner-prod",
    "asset-provisioner-service",
    "content-engine-worker-prod",
    "generate-story-content",
    "koba-wordpress-egress-prod",
    "test-service",
    "wordpress-egress-gateway-prod"
}

def get_admin_token():
    try:
        gcloud = 'gcloud' if os.name != 'nt' else r'C:\Users\kenda\AppData\Local\Google\Cloud SDK\google-cloud-sdk\bin\gcloud.cmd'
        return subprocess.check_output([gcloud, 'auth', 'print-access-token']).decode('utf-8').strip()
    except Exception as e:
        try:
            req = urllib.request.Request(
                "http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token",
                headers={"Metadata-Flavor": "Google"}
            )
            with urllib.request.urlopen(req) as resp:
                return json.loads(resp.read().decode('utf-8'))["access_token"]
        except Exception:
            raise RuntimeError(f"Could not acquire GCP access token: {e}")

def main():
    print("================================================================================")
    print("WORKSTREAM P5: AUTOMATED PRODUCTION SECURITY DRIFT CHECK")
    print("================================================================================")
    admin_token = get_admin_token()
    drift_detected = False
    gcloud = 'gcloud' if os.name != 'nt' else r'C:\Users\kenda\AppData\Local\Google\Cloud SDK\google-cloud-sdk\bin\gcloud.cmd'

    # Check 1: Live Project IAM Policy (Affirmative Existence & Least-Privilege Verification)
    print("\n[Check 1] Auditing Live Project IAM Policy...")
    url = f"https://cloudresourcemanager.googleapis.com/v1/projects/{PROJECT_ID}:getIamPolicy"
    body = json.dumps({"options": {"requestedPolicyVersion": 3}}).encode('utf-8')
    req = urllib.request.Request(url, data=body, headers={"Authorization": f"Bearer {admin_token}", "Content-Type": "application/json"})
    with urllib.request.urlopen(req) as resp:
        pol = json.loads(resp.read().decode('utf-8'))

    print(f"  Live Policy Version: {pol.get('version')}")
    print(f"  Live Policy ETag: {pol.get('etag')}")

    gw_bindings = [b for b in pol.get("bindings", []) if GW_MEMBER in b.get("members", [])]

    has_custom_creator = False
    has_cond_accessor = False
    has_cond_adder = False

    for b in gw_bindings:
        role = b.get("role")
        cond = b.get("condition")

        if role == EXPECTED_CUSTOM_ROLE:
            has_custom_creator = True
            print(f"  Found required custom role: {EXPECTED_CUSTOM_ROLE}")
        elif role == "roles/secretmanager.secretAccessor":
            if cond and cond.get("expression") == EXPECTED_NUMERIC_CEL:
                has_cond_accessor = True
                print("  Found required conditional roles/secretmanager.secretAccessor with verified CEL.")
            else:
                print(f"  DRIFT ALERT: Gateway secretAccessor has invalid condition: {cond}")
                drift_detected = True
        elif role == "roles/secretmanager.secretVersionAdder":
            if cond and cond.get("expression") == EXPECTED_NUMERIC_CEL:
                has_cond_adder = True
                print("  Found required conditional roles/secretmanager.secretVersionAdder with verified CEL.")
            else:
                print(f"  DRIFT ALERT: Gateway secretVersionAdder has invalid condition: {cond}")
                drift_detected = True
        elif role == "roles/secretmanager.admin":
            print(f"  DRIFT ALERT: Gateway SA holds PROHIBITED secretmanager.admin! Condition: {cond}")
            drift_detected = True
        elif not cond:
            print(f"  DRIFT ALERT: Gateway SA holds UNEXPECTED unconditional role: {role}")
            drift_detected = True
        else:
            print(f"  DRIFT ALERT: Gateway SA holds UNEXPECTED conditional role: {role} (Condition: {cond})")
            drift_detected = True

    # Affirmative existence assertions
    if not has_custom_creator:
        print(f"  DRIFT ALERT: Gateway SA is MISSING required custom role {EXPECTED_CUSTOM_ROLE}!")
        drift_detected = True
    if not has_cond_accessor:
        print("  DRIFT ALERT: Gateway SA is MISSING required conditional roles/secretmanager.secretAccessor!")
        drift_detected = True
    if not has_cond_adder:
        print("  DRIFT ALERT: Gateway SA is MISSING required conditional roles/secretmanager.secretVersionAdder!")
        drift_detected = True

    if not drift_detected:
        print("  Check 1 PASSED: Gateway SA strictly confined to least-privilege contract and all required bindings confirmed.")

    # Check 2: Cloud Run Gateway Service & Serving Revision Provenance
    print("\n[Check 2] Auditing Cloud Run Gateway Service & Serving Revision Provenance...")
    out = subprocess.check_output([
        gcloud, 'run', 'services', 'describe', 'wordpress-egress-gateway-prod',
        '--region', 'us-central1',
        '--project', PROJECT_ID,
        '--format', 'json'
    ]).decode('utf-8')
    gw_svc = json.loads(out)
    
    traffic = gw_svc.get("status", {}).get("traffic", [])
    active_rev = next((t["revisionName"] for t in traffic if t.get("percent") == 100), None)
    print(f"  100% Traffic Revision: {active_rev} (Expected: {EXPECTED_GATEWAY_REVISION})")
    if active_rev != EXPECTED_GATEWAY_REVISION:
        print(f"  DRIFT ALERT: Active revision is {active_rev} instead of {EXPECTED_GATEWAY_REVISION}!")
        drift_detected = True
    else:
        # Resolve provenance directly from the Revision resource
        rev_out = subprocess.check_output([
            gcloud, 'run', 'revisions', 'describe', active_rev,
            '--region', 'us-central1',
            '--project', PROJECT_ID,
            '--format', 'json'
        ]).decode('utf-8')
        rev_obj = json.loads(rev_out)
        rev_digest = rev_obj.get("status", {}).get("imageDigest", "")
        rev_image = rev_obj.get("spec", {}).get("containers", [{}])[0].get("image", "")

        print(f"  Serving Revision Image Digest: {rev_digest}")
        if EXPECTED_GATEWAY_IMAGE_DIGEST not in rev_digest and EXPECTED_GATEWAY_IMAGE_DIGEST not in rev_image:
            print(f"  DRIFT ALERT: Serving revision {active_rev} image digest does not contain {EXPECTED_GATEWAY_IMAGE_DIGEST}!")
            drift_detected = True
        else:
            print("  Check 2 PASSED: 100% traffic allocation and serving revision image provenance verified.")

    # Check 3: Dynamic Cloud Run Service Inventory Discovery & Authentication Boundaries
    print("\n[Check 3] Auditing Dynamic Cloud Run Service Inventory & Authentication...")
    list_out = subprocess.check_output([
        gcloud, 'run', 'services', 'list',
        '--region', 'us-central1',
        '--project', PROJECT_ID,
        '--format', 'json'
    ]).decode('utf-8')
    discovered_list = json.loads(list_out)
    discovered_names = {s["metadata"]["name"] for s in discovered_list}

    print(f"  Discovered Cloud Run services count in us-central1: {len(discovered_names)}")
    unexpected_svcs = discovered_names - EXPECTED_SERVICES
    missing_svcs = EXPECTED_SERVICES - discovered_names

    if unexpected_svcs:
        print(f"  DRIFT ALERT: UNINVENTORIED Cloud Run service(s) detected: {unexpected_svcs}!")
        drift_detected = True
    if missing_svcs:
        print(f"  DRIFT ALERT: MISSING expected Cloud Run service(s): {missing_svcs}!")
        drift_detected = True

    if not unexpected_svcs and not missing_svcs:
        print(f"  Service Inventory Confirmed: Exact match with canonical inventory ({len(EXPECTED_SERVICES)} services).")

    # Audit all discovered services for unauthenticated invokers (allUsers)
    for svc_name in sorted(discovered_names):
        svc_iam_out = subprocess.check_output([
            gcloud, 'run', 'services', 'get-iam-policy', svc_name,
            '--region', 'us-central1',
            '--project', PROJECT_ID,
            '--format', 'json'
        ]).decode('utf-8')
        svc_pol = json.loads(svc_iam_out)
        invokers = [b for b in svc_pol.get("bindings", []) if b.get("role") == "roles/run.invoker"]
        has_all_users = any("allUsers" in b.get("members", []) for b in invokers)

        if has_all_users:
            print(f"  DRIFT ALERT: Service {svc_name} allows allUsers in run.invoker!")
            drift_detected = True
        else:
            print(f"  Service {svc_name}: Authenticated only (allUsers strictly absent).")

    print("\n================================================================================")
    if drift_detected:
        print("RESULT: DRIFT DETECTED — Manual Investigation Required!")
        sys.exit(1)
    else:
        print("RESULT: ZERO DRIFT DETECTED — All Security Baselines 100% Verified!")
        print("================================================================================")

if __name__ == '__main__':
    main()
