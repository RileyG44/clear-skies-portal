struct gl_PerVertex {
    @builtin(position) gl_Position: vec4<f32>,
    gl_PointSize: f32,
    gl_ClipDistance: array<f32, 1>,
    gl_CullDistance: array<f32, 1>,
}

struct VertexOutput {
    @location(0) member: vec2<f32>,
    @builtin(position) gl_Position: vec4<f32>,
}

var<private> gl_VertexIndex_1: i32;
var<private> v_screenUv: vec2<f32>;
var<private> unnamed: gl_PerVertex = gl_PerVertex(vec4<f32>(0f, 0f, 0f, 1f), 1f, array<f32, 1>(), array<f32, 1>());

fn main_1() {
    var p: vec2<f32>;

    let _e11: i32 = gl_VertexIndex_1;
    let _e16: i32 = gl_VertexIndex_1;
    p = vec2<f32>(f32(((_e11 << bitcast<u32>(1i)) & 2i)), f32((_e16 & 2i)));
    let _e20: vec2<f32> = p;
    v_screenUv = _e20;
    let _e21: vec2<f32> = p;
    let _e24: vec2<f32> = ((_e21 * 2f) - vec2(1f));
    unnamed.gl_Position = vec4<f32>(_e24.x, _e24.y, 0f, 1f);
    return;
}

@vertex 
fn main(@builtin(vertex_index) gl_VertexIndex: u32) -> VertexOutput {
    gl_VertexIndex_1 = i32(gl_VertexIndex);
    main_1();
    let _e7: f32 = unnamed.gl_Position.y;
    unnamed.gl_Position.y = -(_e7);
    let _e9: vec2<f32> = v_screenUv;
    let _e10: vec4<f32> = unnamed.gl_Position;
    return VertexOutput(_e9, _e10);
}
