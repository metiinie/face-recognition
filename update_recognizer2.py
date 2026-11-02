import os

file_path = os.path.join("backend", "face_engine", "recognizer.py")
with open(file_path, "r", encoding="utf-8") as f:
    content = f.read()

# Replace block in ONNX loop
old_onnx_crop = """            # 128-D spatial gradient embedding for crop
            gx = np.diff(crop_gray, axis=1)
            gy = np.diff(crop_gray, axis=0)
            gx = np.pad(gx, ((0, 0), (0, 1)), mode="edge")[16:144, 16:144]
            gy = np.pad(gy, ((0, 1), (0, 0)), mode="edge")[16:144, 16:144]

            magnitude = np.sqrt(gx**2 + gy**2)
            orientation = (np.arctan2(gy, gx) * (180.0 / np.pi)) % 180.0

            cell_h, cell_w = 32, 32
            descriptor_128 = []
            for cy_i in range(4):
                for cx_i in range(4):
                    c_mag = magnitude[cy_i * cell_h : (cy_i + 1) * cell_h, cx_i * cell_w : (cx_i + 1) * cell_w]
                    c_ori = orientation[cy_i * cell_h : (cy_i + 1) * cell_h, cx_i * cell_w : (cx_i + 1) * cell_w]
                    hist, _ = np.histogram(c_ori, bins=8, range=(0.0, 180.0), weights=c_mag)
                    descriptor_128.extend(hist.tolist())

            vec = np.asarray(descriptor_128, dtype=np.float64)
            vec = vec - np.mean(vec)
            norm = np.linalg.norm(vec)
            if norm > 0:
                vec = vec / norm
            embedding = [round(float(val), 6) for val in vec]"""

new_onnx_crop = """            # 1. Primary: Extract 128-D SFace deep neural embedding
            neural_vec = extract_neural_embedding(face_crop)
            if neural_vec is not None:
                embedding = neural_vec
            else:
                # Fallback: 128-D spatial gradient descriptor
                gx = np.diff(crop_gray, axis=1)
                gy = np.diff(crop_gray, axis=0)
                gx = np.pad(gx, ((0, 0), (0, 1)), mode="edge")[16:144, 16:144]
                gy = np.pad(gy, ((0, 1), (0, 0)), mode="edge")[16:144, 16:144]

                magnitude = np.sqrt(gx**2 + gy**2)
                orientation = (np.arctan2(gy, gx) * (180.0 / np.pi)) % 180.0

                cell_h, cell_w = 32, 32
                descriptor_128 = []
                for cy_i in range(4):
                    for cx_i in range(4):
                        c_mag = magnitude[cy_i * cell_h : (cy_i + 1) * cell_h, cx_i * cell_w : (cx_i + 1) * cell_w]
                        c_ori = orientation[cy_i * cell_h : (cy_i + 1) * cell_h, cx_i * cell_w : (cx_i + 1) * cell_w]
                        hist, _ = np.histogram(c_ori, bins=8, range=(0.0, 180.0), weights=c_mag)
                        descriptor_128.extend(hist.tolist())

                vec = np.asarray(descriptor_128, dtype=np.float64)
                vec = vec - np.mean(vec)
                norm = np.linalg.norm(vec)
                if norm > 0:
                    vec = vec / norm
                embedding = [round(float(val), 6) for val in vec]"""

assert old_onnx_crop in content, "old_onnx_crop not found"
content = content.replace(old_onnx_crop, new_onnx_crop, 1)

# Also replace in the fallback skin cluster loop
old_skin_crop = """        gx = np.diff(crop_gray, axis=1)
        gy = np.diff(crop_gray, axis=0)
        gx = np.pad(gx, ((0, 0), (0, 1)), mode="edge")[16:144, 16:144]
        gy = np.pad(gy, ((0, 1), (0, 0)), mode="edge")[16:144, 16:144]

        magnitude = np.sqrt(gx**2 + gy**2)
        orientation = (np.arctan2(gy, gx) * (180.0 / np.pi)) % 180.0

        cell_h, cell_w = 32, 32
        descriptor_128 = []
        for cy_i in range(4):
            for cx_i in range(4):
                c_mag = magnitude[cy_i * cell_h : (cy_i + 1) * cell_h, cx_i * cell_w : (cx_i + 1) * cell_w]
                c_ori = orientation[cy_i * cell_h : (cy_i + 1) * cell_h, cx_i * cell_w : (cx_i + 1) * cell_w]
                hist, _ = np.histogram(c_ori, bins=8, range=(0.0, 180.0), weights=c_mag)
                descriptor_128.extend(hist.tolist())

        vec = np.asarray(descriptor_128, dtype=np.float64)
        vec = vec - np.mean(vec)
        norm = np.linalg.norm(vec)
        if norm > 0:
            vec = vec / norm
        embedding = [round(float(val), 6) for val in vec]"""

new_skin_crop = """        # 1. Primary: Extract 128-D SFace deep neural embedding
        neural_vec = extract_neural_embedding(face_crop)
        if neural_vec is not None:
            embedding = neural_vec
        else:
            # Fallback: 128-D spatial gradient descriptor
            gx = np.diff(crop_gray, axis=1)
            gy = np.diff(crop_gray, axis=0)
            gx = np.pad(gx, ((0, 0), (0, 1)), mode="edge")[16:144, 16:144]
            gy = np.pad(gy, ((0, 1), (0, 0)), mode="edge")[16:144, 16:144]

            magnitude = np.sqrt(gx**2 + gy**2)
            orientation = (np.arctan2(gy, gx) * (180.0 / np.pi)) % 180.0

            cell_h, cell_w = 32, 32
            descriptor_128 = []
            for cy_i in range(4):
                for cx_i in range(4):
                    c_mag = magnitude[cy_i * cell_h : (cy_i + 1) * cell_h, cx_i * cell_w : (cx_i + 1) * cell_w]
                    c_ori = orientation[cy_i * cell_h : (cy_i + 1) * cell_h, cx_i * cell_w : (cx_i + 1) * cell_w]
                    hist, _ = np.histogram(c_ori, bins=8, range=(0.0, 180.0), weights=c_mag)
                    descriptor_128.extend(hist.tolist())

            vec = np.asarray(descriptor_128, dtype=np.float64)
            vec = vec - np.mean(vec)
            norm = np.linalg.norm(vec)
            if norm > 0:
                vec = vec / norm
            embedding = [round(float(val), 6) for val in vec]"""

assert old_skin_crop in content, "old_skin_crop not found"
content = content.replace(old_skin_crop, new_skin_crop, 1)

with open(file_path, "w", encoding="utf-8") as f:
    f.write(content)

print("Updated extract_multiple_faces_from_image with neural embedding.")
