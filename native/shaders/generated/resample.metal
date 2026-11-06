// language: metal2.3
#include <metal_stdlib>
#include <simd/simd.h>

using metal::uint;

struct Params {
    metal::float2 origin;
    metal::float2 axis_x;
    metal::float2 axis_y;
    uint magnify;
    uint pad;
};
constant float INVALID = -300000000000000000000000000000000000000.0;

bool valid(
    float v
) {
    bool local_1 = {};
    if ((as_type<uint>(v) & 2147483647u) < 2139095040u) {
        local_1 = v > -100000000000000000000.0;
    } else {
        local_1 = false;
    }
    bool _e11 = local_1;
    return _e11;
}

float at(
    metal::int2 p,
    metal::int2 size,
    metal::texture2d<float, metal::access::sample> store
) {
    bool local_2 = {};
    if (!(metal::any(p < metal::int2(0)))) {
        local_2 = metal::any(p >= size);
    } else {
        local_2 = true;
    }
    bool _e12 = local_2;
    if (_e12) {
        return INVALID;
    }
    metal::float4 _e16 = store.read(metal::uint2(p), 0);
    return _e16.x;
}

metal::float4 cubic(
    float t
) {
    float t2_ = t * t;
    float t3_ = t2_ * t;
    return metal::float4((-(t3_) + (2.0 * t2_)) - t, ((3.0 * t3_) - (5.0 * t2_)) + 2.0, ((-3.0 * t3_) + (4.0 * t2_)) + t, t3_ - t2_) * 0.5;
}
metal::int2 naga_f2i32(metal::float2 value) {
    return static_cast<metal::int2>(metal::clamp(value, -2147483600.0, 2147483500.0));
}


struct main_Input {
};
[[max_total_threads_per_threadgroup(256)]] kernel void main_(
  metal::uint3 id [[thread_position_in_grid]]
, constant Params& params [[buffer(0)]]
, metal::texture2d<float, metal::access::sample> store [[texture(1)]]
, metal::texture2d<float, metal::access::write> field [[texture(2)]]
) {
    float value = 0.0;
    bool complete = true;
    int y = 0;
    int x = {};
    float sum = 0.0;
    float weight = 0.0;
    int y_1 = 0;
    int x_1 = {};
    bool local = {};
    metal::uint2 out = metal::uint2(field.get_width(), field.get_height());
    if (metal::any(id.xy >= out)) {
        return;
    }
    metal::int2 size_1 = static_cast<metal::int2>(metal::uint2(store.get_width(), store.get_height()));
    metal::float2 _e11 = params.origin;
    metal::float2 _e16 = params.axis_x;
    metal::float2 _e23 = params.axis_y;
    metal::float2 p_1 = (_e11 + (static_cast<float>(id.x) * _e16)) + (static_cast<float>(id.y) * _e23);
    metal::int2 b = naga_f2i32(metal::floor(p_1));
    metal::float2 f = p_1 - static_cast<metal::float2>(b);
    uint _e32 = params.magnify;
    if (_e32 != 0u) {
        metal::float4 _e36 = cubic(f.x);
        metal::float4 _e38 = cubic(f.y);
        uint2 loop_bound = uint2(4294967295u);
        bool loop_init = true;
        while(true) {
            if (metal::all(loop_bound == uint2(0u))) { break; }
            loop_bound -= uint2(loop_bound.y == 0u, 1u);
            if (!loop_init) {
                int _e76 = y;
                y = as_type<int>(as_type<uint>(_e76) + as_type<uint>(1));
            }
            loop_init = false;
            int _e45 = y;
            if (_e45 < 4) {
            } else {
                break;
            }
            {
                x = 0;
                uint2 loop_bound_1 = uint2(4294967295u);
                bool loop_init_1 = true;
                while(true) {
                    if (metal::all(loop_bound_1 == uint2(0u))) { break; }
                    loop_bound_1 -= uint2(loop_bound_1.y == 0u, 1u);
                    if (!loop_init_1) {
                        int _e73 = x;
                        x = as_type<int>(as_type<uint>(_e73) + as_type<uint>(1));
                    }
                    loop_init_1 = false;
                    int _e50 = x;
                    if (_e50 < 4) {
                    } else {
                        break;
                    }
                    {
                        int _e53 = x;
                        int _e56 = y;
                        float _e61 = at(as_type<metal::int2>(as_type<metal::uint2>(b) + as_type<metal::uint2>(metal::int2(as_type<int>(as_type<uint>(_e53) - as_type<uint>(1)), as_type<int>(as_type<uint>(_e56) - as_type<uint>(1))))), size_1, store);
                        bool _e62 = valid(_e61);
                        if (_e62) {
                            float _e63 = value;
                            int _e64 = x;
                            int _e67 = y;
                            value = _e63 + ((_e61 * _e36[_e64]) * _e38[_e67]);
                        } else {
                            complete = false;
                        }
                    }
                }
            }
        }
        bool _e78 = complete;
        if (_e78) {
            float _e82 = value;
            field.write(metal::float4(_e82, 0.0, 0.0, 0.0), metal::uint2(static_cast<metal::int2>(id.xy)));
            return;
        }
    }
    uint2 loop_bound_2 = uint2(4294967295u);
    bool loop_init_2 = true;
    while(true) {
        if (metal::all(loop_bound_2 == uint2(0u))) { break; }
        loop_bound_2 -= uint2(loop_bound_2.y == 0u, 1u);
        if (!loop_init_2) {
            int _e139 = y_1;
            y_1 = as_type<int>(as_type<uint>(_e139) + as_type<uint>(1));
        }
        loop_init_2 = false;
        int _e93 = y_1;
        if (_e93 < 2) {
        } else {
            break;
        }
        {
            x_1 = 0;
            uint2 loop_bound_3 = uint2(4294967295u);
            bool loop_init_3 = true;
            while(true) {
                if (metal::all(loop_bound_3 == uint2(0u))) { break; }
                loop_bound_3 -= uint2(loop_bound_3.y == 0u, 1u);
                if (!loop_init_3) {
                    int _e136 = x_1;
                    x_1 = as_type<int>(as_type<uint>(_e136) + as_type<uint>(1));
                }
                loop_init_3 = false;
                int _e98 = x_1;
                if (_e98 < 2) {
                } else {
                    break;
                }
                {
                    int _e101 = x_1;
                    int _e102 = y_1;
                    float _e105 = at(as_type<metal::int2>(as_type<metal::uint2>(b) + as_type<metal::uint2>(metal::int2(_e101, _e102))), size_1, store);
                    int _e110 = x_1;
                    int _e118 = y_1;
                    float w = ((_e110 == 0) ? (1.0 - f.x) : f.x) * ((_e118 == 0) ? (1.0 - f.y) : f.y);
                    bool _e123 = valid(_e105);
                    if (_e123) {
                        local = w > 0.0;
                    } else {
                        local = false;
                    }
                    bool _e129 = local;
                    if (_e129) {
                        float _e130 = sum;
                        sum = _e130 + (_e105 * w);
                        float _e133 = weight;
                        weight = _e133 + w;
                    }
                }
            }
        }
    }
    float _e142 = sum;
    float _e143 = weight;
    float _e145 = weight;
    float value_1 = (_e145 > 0.0) ? (_e142 / _e143) : INVALID;
    field.write(metal::float4(value_1, 0.0, 0.0, 0.0), metal::uint2(static_cast<metal::int2>(id.xy)));
    return;
}
