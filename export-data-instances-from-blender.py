import bpy
import struct
from array import array
from pathlib import Path
from mathutils import Vector, Matrix

# ============================================================
# USER SETTINGS (EDIT THESE)
# ============================================================
OUTPUT_PATH = r"C:\Users\Rick\Desktop\proj-medevil-village\code\public\data.bin"

SOURCE_OBJECT = ""           # if empty: active object or first mesh found
APPLY_MODIFIERS = True
USE_WORLD_SPACE = True

# Export extras
WRITE_COLORS = False
EXPORT_UVS = True

# Color source when WRITE_COLORS = True
COLOR_SOURCE = "AUTO"        # AUTO | IMAGE | VERTEX_COLORS | NONE
IMAGE_NAME = "diffuse.png"
WRAP_UV = True
CONVERT_SRGB_TO_LINEAR = True

# Quantization control
# X/Y vectors are stored as int16 normalized in [-VEC_RANGE, +VEC_RANGE]
# Pick something >= your max triangle edge length. If unsure, leave AUTO (0.0).
VEC_RANGE = 0.0              # 0.0 = AUTO (computed from mesh)

PROGRESS_EVERY = 100000

# ============================================================
# HELPERS
# ============================================================

def ensure_object_mode():
    if bpy.context.mode != 'OBJECT':
        try:
            bpy.ops.object.mode_set(mode='OBJECT')
        except Exception:
            pass

def pick_source_object():
    if SOURCE_OBJECT:
        obj = bpy.data.objects.get(SOURCE_OBJECT)
        if not obj:
            raise ValueError(f"SOURCE_OBJECT not found: {SOURCE_OBJECT}")
        if obj.type != 'MESH':
            raise ValueError(f"SOURCE_OBJECT is not a mesh: {SOURCE_OBJECT}")
        return obj

    obj = bpy.context.active_object
    if obj and obj.type == 'MESH':
        return obj

    for o in bpy.context.scene.objects:
        if o.type == 'MESH':
            return o

    raise RuntimeError("No mesh object found in scene.")

def get_active_color_layer(mesh):
    if hasattr(mesh, "color_attributes") and mesh.color_attributes:
        layer = mesh.color_attributes.active_color or mesh.color_attributes[0]
        return layer
    if hasattr(mesh, "vertex_colors") and mesh.vertex_colors:
        return mesh.vertex_colors.active or mesh.vertex_colors[0]
    return None

def srgb_to_linear(c):
    if c <= 0.04045:
        return c / 12.92
    return ((c + 0.055) / 1.055) ** 2.4

def clamp01(x):
    if x < 0.0:
        return 0.0
    if x > 1.0:
        return 1.0
    return x

def find_image_for_object(obj):
    if IMAGE_NAME:
        img = bpy.data.images.get(IMAGE_NAME)
        if img:
            return img
        for img in bpy.data.images:
            if Path(img.filepath).name.lower() == IMAGE_NAME.lower():
                return img

    preferred = []
    fallback = []
    for mat in obj.data.materials:
        if not mat or not mat.use_nodes:
            continue
        for node in mat.node_tree.nodes:
            if node.type == 'TEX_IMAGE' and node.image:
                name = (node.image.name or "").lower()
                if "diffuse" in name or "albedo" in name or "basecolor" in name:
                    preferred.append(node.image)
                else:
                    fallback.append(node.image)
    if preferred:
        return preferred[0]
    if fallback:
        return fallback[0]
    return None

def sample_image(pixels, width, height, u, v):
    if WRAP_UV:
        u = u % 1.0
        v = v % 1.0
    else:
        u = clamp01(u)
        v = clamp01(v)

    x = int(u * (width - 1))
    y = int(v * (height - 1))
    idx = (y * width + x) * 4
    r = pixels[idx]
    g = pixels[idx + 1]
    b = pixels[idx + 2]
    a = pixels[idx + 3]
    return r, g, b, a

def triangle_color_from_image(loop_indices, uv_layer, pixels, width, height):
    u = 0.0
    v = 0.0
    for li in loop_indices:
        uv = uv_layer.data[li].uv
        u += uv.x
        v += uv.y
    u /= 3.0
    v /= 3.0

    r, g, b, a = sample_image(pixels, width, height, u, v)

    if CONVERT_SRGB_TO_LINEAR:
        r = srgb_to_linear(r)
        g = srgb_to_linear(g)
        b = srgb_to_linear(b)

    r8 = int(clamp01(r) * 255 + 0.5)
    g8 = int(clamp01(g) * 255 + 0.5)
    b8 = int(clamp01(b) * 255 + 0.5)
    a8 = int(clamp01(a) * 255 + 0.5)
    return r8, g8, b8, a8

def triangle_color_from_vertex_colors(loop_indices, color_layer):
    r = g = b = a = 0.0
    n = 0
    size = len(color_layer.data)
    for li in loop_indices:
        if li >= size:
            continue
        c = color_layer.data[li].color
        r += c[0]; g += c[1]; b += c[2]
        a += c[3] if len(c) > 3 else 1.0
        n += 1
    if n == 0:
        r = g = b = a = 1.0
    else:
        r /= n; g /= n; b /= n; a /= n

    if CONVERT_SRGB_TO_LINEAR:
        r = srgb_to_linear(r)
        g = srgb_to_linear(g)
        b = srgb_to_linear(b)

    r8 = int(clamp01(r) * 255 + 0.5)
    g8 = int(clamp01(g) * 255 + 0.5)
    b8 = int(clamp01(b) * 255 + 0.5)
    a8 = int(clamp01(a) * 255 + 0.5)
    return r8, g8, b8, a8

def quant_u16_01(x):
    if x < 0.0: x = 0.0
    if x > 1.0: x = 1.0
    return int(x * 65535.0 + 0.5)

def quant_i16_norm(x):
    if x < -1.0: x = -1.0
    if x > 1.0:  x = 1.0
    return int(x * 32767.0 + (0.5 if x >= 0 else -0.5))

# ============================================================
# MAIN
# ============================================================

def main():
    ensure_object_mode()

    obj = pick_source_object()
    print("Source object:", obj.name)

    depsgraph = bpy.context.evaluated_depsgraph_get()
    eval_obj = obj.evaluated_get(depsgraph) if APPLY_MODIFIERS else obj
    mesh = eval_obj.to_mesh()

    try:
        mesh.calc_loop_triangles()
        loop_tris = mesh.loop_triangles
        count = len(loop_tris)
        print("Triangle count:", count)
        if count == 0:
            raise RuntimeError("Mesh has no triangles.")

        # Color + UV setup
        write_colors = bool(WRITE_COLORS)
        write_uvs = bool(EXPORT_UVS)

        uv_layer = None
        color_layer = None
        image = None
        pixels = None
        width = height = 0

        color_source = (COLOR_SOURCE or "NONE").upper()
        if color_source == "NONE":
            write_colors = False

        if write_colors and color_source in ("AUTO", "VERTEX_COLORS"):
            color_layer = get_active_color_layer(mesh)
            if color_layer:
                print("Using vertex colors:", color_layer.name)
            elif color_source == "VERTEX_COLORS":
                print("No vertex colors found. Disabling colors.")
                write_colors = False

        needs_uv_for_color = write_colors and (color_layer is None) and color_source in ("AUTO", "IMAGE")

        if write_uvs or needs_uv_for_color:
            uv_layer = mesh.uv_layers.active
            if not uv_layer:
                if write_uvs:
                    print("No UV layer found. Disabling UV export.")
                    write_uvs = False
                if needs_uv_for_color:
                    print("No UV layer found. Disabling colors.")
                    write_colors = False
                    needs_uv_for_color = False

        if write_colors and needs_uv_for_color:
            image = find_image_for_object(obj)
            if not image:
                print("No image found. Disabling colors.")
                write_colors = False
            else:
                image.reload()
                width, height = image.size
                pixels = list(image.pixels)
                print("Using image:", image.name, "size:", width, "x", height)

        # World matrix selection
        mw = eval_obj.matrix_world if USE_WORLD_SPACE else Matrix.Identity(4)

        # Compute world-space bounds (AABB) for v0 quantization
        bmin = Vector((1e30, 1e30, 1e30))
        bmax = Vector((-1e30, -1e30, -1e30))
        for v in mesh.vertices:
            p = mw @ v.co
            bmin.x = min(bmin.x, p.x); bmin.y = min(bmin.y, p.y); bmin.z = min(bmin.z, p.z)
            bmax.x = max(bmax.x, p.x); bmax.y = max(bmax.y, p.y); bmax.z = max(bmax.z, p.z)

        size = bmax - bmin
        eps = 1e-12
        inv_size = Vector((
            1.0 / (size.x if abs(size.x) > eps else 1.0),
            1.0 / (size.y if abs(size.y) > eps else 1.0),
            1.0 / (size.z if abs(size.z) > eps else 1.0),
        ))

        # Auto vec range: maximum observed length of (v1-v0) or (v2-v0)
        vec_range = float(VEC_RANGE)
        if vec_range <= 0.0:
            max_len = 0.0
            for tri in loop_tris:
                l0, l1, l2 = tri.loops
                p0 = mw @ mesh.vertices[mesh.loops[l0].vertex_index].co
                p1 = mw @ mesh.vertices[mesh.loops[l1].vertex_index].co
                p2 = mw @ mesh.vertices[mesh.loops[l2].vertex_index].co
                x = p1 - p0
                y = p2 - p0
                max_len = max(max_len, x.length, y.length)
            vec_range = max_len if max_len > 0.0 else 1.0

        print("AABB min:", tuple(bmin))
        print("AABB max:", tuple(bmax))
        print("VEC_RANGE:", vec_range)

        # Output path
        output_path = bpy.path.abspath(OUTPUT_PATH)
        Path(output_path).parent.mkdir(parents=True, exist_ok=True)

        # File format: ITRI v1
        # Header:
        #  magic(4s), version(u32), count(u32), flags(u32),
        #  headerBytes(u32), v0Off(u32), xOff(u32), yOff(u32), colorsOff(u32), uvsOff(u32), reserved(u32),
        #  bmin(3f), bmax(3f), vecRange(f)
        flags = (1 if write_colors else 0) | (2 if write_uvs else 0)

        header_fmt = "<4s10I7f"   # ✅ FIXED
        header_bytes = struct.calcsize(header_fmt)

        v0_size = count * 3 * 2
        x_size  = count * 3 * 2
        y_size  = count * 3 * 2
        colors_size = count * 4 if write_colors else 0
        uvs_size = count * 6 * 4 if write_uvs else 0

        v0_offset = header_bytes
        x_offset = v0_offset + v0_size
        y_offset = x_offset + x_size
        colors_offset = (y_offset + y_size) if write_colors else 0
        uvs_offset = (y_offset + y_size + colors_size) if write_uvs else 0

        print("Writing:", output_path)
        print("Has colors:", write_colors)
        print("Has uvs:", write_uvs)
        print("Header bytes:", header_bytes)
        print("Offsets: v0", v0_offset, "x", x_offset, "y", y_offset, "colors", colors_offset, "uvs", uvs_offset)

        with open(output_path, "wb") as f:
            f.write(struct.pack(
                header_fmt,
                b"ITRI",
                1,               # version
                count,
                flags,
                header_bytes,
                v0_offset,
                x_offset,
                y_offset,
                colors_offset,
                uvs_offset,
                0,               # reserved
                bmin.x, bmin.y, bmin.z,
                bmax.x, bmax.y, bmax.z,
                float(vec_range)
            ))

            v0_u16 = array('H')  # uint16
            x_i16  = array('h')  # int16
            y_i16  = array('h')  # int16
            colors = bytearray() if write_colors else None
            uvs = array('f') if write_uvs else None

            v0_extend = v0_u16.extend
            x_extend = x_i16.extend
            y_extend = y_i16.extend
            uvs_extend = uvs.extend if uvs is not None else None

            for i, tri in enumerate(loop_tris):
                l0, l1, l2 = tri.loops

                p0 = mw @ mesh.vertices[mesh.loops[l0].vertex_index].co
                p1 = mw @ mesh.vertices[mesh.loops[l1].vertex_index].co
                p2 = mw @ mesh.vertices[mesh.loops[l2].vertex_index].co

                x = p1 - p0
                y = p2 - p0

                nx = (p0.x - bmin.x) * inv_size.x
                ny = (p0.y - bmin.y) * inv_size.y
                nz = (p0.z - bmin.z) * inv_size.z
                v0_extend([quant_u16_01(nx), quant_u16_01(ny), quant_u16_01(nz)])

                rx = x.x / vec_range; ry = x.y / vec_range; rz = x.z / vec_range
                sx = y.x / vec_range; sy = y.y / vec_range; sz = y.z / vec_range
                x_extend([quant_i16_norm(rx), quant_i16_norm(ry), quant_i16_norm(rz)])
                y_extend([quant_i16_norm(sx), quant_i16_norm(sy), quant_i16_norm(sz)])

                if write_colors:
                    if color_layer is not None:
                        r8, g8, b8, a8 = triangle_color_from_vertex_colors(tri.loops, color_layer)
                    else:
                        r8, g8, b8, a8 = triangle_color_from_image(tri.loops, uv_layer, pixels, width, height)
                    colors.append(r8); colors.append(g8); colors.append(b8); colors.append(a8)

                if write_uvs:
                    uv0 = uv_layer.data[l0].uv
                    uv1 = uv_layer.data[l1].uv
                    uv2 = uv_layer.data[l2].uv
                    uvs_extend([uv0.x, uv0.y, uv1.x, uv1.y, uv2.x, uv2.y])

                if PROGRESS_EVERY and (i + 1) % PROGRESS_EVERY == 0:
                    print(f"  processed {i + 1} / {count}")

            f.seek(v0_offset); f.write(v0_u16.tobytes())
            f.seek(x_offset);  f.write(x_i16.tobytes())
            f.seek(y_offset);  f.write(y_i16.tobytes())

            if write_colors:
                f.seek(colors_offset); f.write(colors)

            if write_uvs:
                f.seek(uvs_offset); f.write(uvs.tobytes())

        print("Done.")

    finally:
        eval_obj.to_mesh_clear()

if __name__ == "__main__":
    main()
