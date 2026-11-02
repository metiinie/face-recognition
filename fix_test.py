import os

file_path = os.path.join("backend", "tests", "test_v2_continuous_entrance.py")
with open(file_path, "r", encoding="utf-8") as f:
    text = f.read()

target = """        # 4. Another employee with no open session tries to exit physical OUT gate -> rejected
        payload_no_sess = {"simulated_staff": ["EIPC-EMP-002"]}
        res_no_sess = manager.process_frame(st_out, payload_no_sess, override_gate_mode="OUT")
        assert res_no_sess["faces"][0]["action_status"] == "NO_OPEN_SESSION\""""

replacement = """        # 4. Same employee tries to exit physical OUT gate again without an open session -> rejected
        manager._cooldown_cache[(st_out.station_code, emp.id)] = utc_now() - timedelta(seconds=40)
        res_no_sess = manager.process_frame(st_out, payload_in, override_gate_mode="OUT")
        assert res_no_sess["faces"][0]["action_status"] == "NO_OPEN_SESSION\""""

text_crlf = "\r\n" in text
target_norm = target.replace("\n", "\r\n") if text_crlf else target
replacement_norm = replacement.replace("\n", "\r\n") if text_crlf else replacement

assert target_norm in text, "Target not found"
text = text.replace(target_norm, replacement_norm, 1)

with open(file_path, "w", encoding="utf-8") as f:
    f.write(text)

print("Test updated successfully!")
