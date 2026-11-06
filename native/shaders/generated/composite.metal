// language: metal2.3
#include <metal_stdlib>
#include <simd/simd.h>

using metal::uint;

struct _mslBufferSizes {
    uint size2;
    uint size3;
};

struct Draw {
    metal::float2 origin;
    float scale;
    float rank;
    metal::uint4 rect;
    uint layer;
    uint pad0_;
    uint pad1_;
    uint pad2_;
};
struct Job {
    metal::uint2 origin;
    uint first;
    uint count;
};
typedef Job type_8[1];
typedef Draw type_9[1];
constant int TILE = 256;
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
    uint layer,
    metal::int2 p,
    metal::texture2d_array<float, metal::access::sample> pool
) {
    metal::float4 _e9 = pool.read(metal::uint2(metal::clamp(p, metal::int2(0), metal::int2(255))), layer, 0);
    return _e9.x;
}

metal::float4 cubic(
    float t
) {
    float t2_ = t * t;
    float t3_ = t2_ * t;
    return metal::float4((-(t3_) + (2.0 * t2_)) - t, ((3.0 * t3_) - (5.0 * t2_)) + 2.0, ((-3.0 * t3_) + (4.0 * t2_)) + t, t3_ - t2_) * 0.5;
}

int naga_f2i32(float value) {
    return static_cast<int>(metal::clamp(value, -2147483600.0, 2147483500.0));
}

metal::int2 naga_f2i32(metal::float2 value) {
    return static_cast<metal::int2>(metal::clamp(value, -2147483600.0, 2147483500.0));
}

metal::float2 sample(
    Draw d,
    metal::uint2 t_1,
    metal::texture2d_array<float, metal::access::sample> pool
) {
    float sum = 0.0;
    float count = 0.0;
    int y = 0;
    int x = {};
    float value = 0.0;
    bool complete = true;
    int y_1 = 0;
    int x_1 = {};
    float sum_1 = 0.0;
    float weight = 0.0;
    int y_2 = 0;
    int x_2 = {};
    bool local_2 = {};
    metal::float2 p_1 = d.origin + (static_cast<metal::float2>(t_1) * d.scale);
    if (d.scale > 1.0) {
        int n = naga_f2i32(metal::rint(d.scale));
        metal::int2 start = naga_f2i32(metal::rint(p_1 + metal::float2(0.5 - (0.5 * d.scale))));
        uint2 loop_bound = uint2(4294967295u);
        bool loop_init = true;
        while(true) {
            if (metal::all(loop_bound == uint2(0u))) { break; }
            loop_bound -= uint2(loop_bound.y == 0u, 1u);
            if (!loop_init) {
                int _e50 = y;
                y = as_type<int>(as_type<uint>(_e50) + as_type<uint>(1));
            }
            loop_init = false;
            int _e28 = y;
            if (_e28 < n) {
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
                        int _e47 = x;
                        x = as_type<int>(as_type<uint>(_e47) + as_type<uint>(1));
                    }
                    loop_init_1 = false;
                    int _e32 = x;
                    if (_e32 < n) {
                    } else {
                        break;
                    }
                    {
                        int _e35 = x;
                        int _e36 = y;
                        float _e39 = at(d.layer, as_type<metal::int2>(as_type<metal::uint2>(start) + as_type<metal::uint2>(metal::int2(_e35, _e36))), pool);
                        bool _e40 = valid(_e39);
                        if (_e40) {
                            float _e41 = sum;
                            sum = _e41 + _e39;
                            float _e43 = count;
                            count = _e43 + 1.0;
                        }
                    }
                }
            }
        }
        float _e55 = sum;
        float _e56 = count;
        float _e60 = count;
        return (_e60 > 0.0) ? metal::float2(_e55 / _e56, 1.0) : metal::float2(-300000000000000000000000000000000000000.0, 0.0);
    }
    if (d.scale == 1.0) {
        float _e70 = at(d.layer, naga_f2i32(metal::rint(p_1)), pool);
        bool _e76 = valid(_e70);
        return _e76 ? metal::float2(_e70, 1.0) : metal::float2(-300000000000000000000000000000000000000.0, 0.0);
    }
    metal::int2 b = naga_f2i32(metal::floor(p_1));
    metal::float2 f = p_1 - static_cast<metal::float2>(b);
    metal::float4 _e83 = cubic(f.x);
    metal::float4 _e85 = cubic(f.y);
    uint2 loop_bound_2 = uint2(4294967295u);
    bool loop_init_2 = true;
    while(true) {
        if (metal::all(loop_bound_2 == uint2(0u))) { break; }
        loop_bound_2 -= uint2(loop_bound_2.y == 0u, 1u);
        if (!loop_init_2) {
            int _e124 = y_1;
            y_1 = as_type<int>(as_type<uint>(_e124) + as_type<uint>(1));
        }
        loop_init_2 = false;
        int _e92 = y_1;
        if (_e92 < 4) {
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
                    int _e121 = x_1;
                    x_1 = as_type<int>(as_type<uint>(_e121) + as_type<uint>(1));
                }
                loop_init_3 = false;
                int _e97 = x_1;
                if (_e97 < 4) {
                } else {
                    break;
                }
                {
                    int _e101 = x_1;
                    int _e104 = y_1;
                    float _e109 = at(d.layer, as_type<metal::int2>(as_type<metal::uint2>(b) + as_type<metal::uint2>(metal::int2(as_type<int>(as_type<uint>(_e101) - as_type<uint>(1)), as_type<int>(as_type<uint>(_e104) - as_type<uint>(1))))), pool);
                    bool _e110 = valid(_e109);
                    if (_e110) {
                        float _e111 = value;
                        int _e112 = x_1;
                        int _e115 = y_1;
                        value = _e111 + ((_e109 * _e83[_e112]) * _e85[_e115]);
                    } else {
                        complete = false;
                    }
                }
            }
        }
    }
    bool _e126 = complete;
    if (_e126) {
        float _e127 = value;
        return metal::float2(_e127, 1.0);
    }
    uint2 loop_bound_4 = uint2(4294967295u);
    bool loop_init_4 = true;
    while(true) {
        if (metal::all(loop_bound_4 == uint2(0u))) { break; }
        loop_bound_4 -= uint2(loop_bound_4.y == 0u, 1u);
        if (!loop_init_4) {
            int _e183 = y_2;
            y_2 = as_type<int>(as_type<uint>(_e183) + as_type<uint>(1));
        }
        loop_init_4 = false;
        int _e136 = y_2;
        if (_e136 < 2) {
        } else {
            break;
        }
        {
            x_2 = 0;
            uint2 loop_bound_5 = uint2(4294967295u);
            bool loop_init_5 = true;
            while(true) {
                if (metal::all(loop_bound_5 == uint2(0u))) { break; }
                loop_bound_5 -= uint2(loop_bound_5.y == 0u, 1u);
                if (!loop_init_5) {
                    int _e180 = x_2;
                    x_2 = as_type<int>(as_type<uint>(_e180) + as_type<uint>(1));
                }
                loop_init_5 = false;
                int _e141 = x_2;
                if (_e141 < 2) {
                } else {
                    break;
                }
                {
                    int _e145 = x_2;
                    int _e146 = y_2;
                    float _e149 = at(d.layer, as_type<metal::int2>(as_type<metal::uint2>(b) + as_type<metal::uint2>(metal::int2(_e145, _e146))), pool);
                    int _e154 = x_2;
                    int _e162 = y_2;
                    float w = ((_e154 == 0) ? (1.0 - f.x) : f.x) * ((_e162 == 0) ? (1.0 - f.y) : f.y);
                    bool _e167 = valid(_e149);
                    if (_e167) {
                        local_2 = w > 0.0;
                    } else {
                        local_2 = false;
                    }
                    bool _e173 = local_2;
                    if (_e173) {
                        float _e174 = sum_1;
                        sum_1 = _e174 + (_e149 * w);
                        float _e177 = weight;
                        weight = _e177 + w;
                    }
                }
            }
        }
    }
    float _e188 = sum_1;
    float _e189 = weight;
    float _e193 = weight;
    return (_e193 > 0.0) ? metal::float2(_e188 / _e189, 1.0) : metal::float2(-300000000000000000000000000000000000000.0, 0.0);
}

struct main_Input {
};
[[max_total_threads_per_threadgroup(256)]] kernel void main_(
  metal::uint3 id [[thread_position_in_grid]]
, metal::texture2d_array<float, metal::access::sample> pool [[texture(0)]]
, metal::texture2d<float, metal::access::write> store [[texture(1)]]
, device type_8 const& jobs [[buffer(2)]]
, device type_9 const& draws [[buffer(3)]]
, constant _mslBufferSizes& _buffer_sizes [[buffer(30)]]
) {
    metal::float2 result = metal::float2(-300000000000000000000000000000000000000.0, 0.0);
    uint i = {};
    bool local = {};
    Job job = jobs[id.z];
    metal::uint2 t_2 = id.xy;
    i = job.count;
    uint2 loop_bound_6 = uint2(4294967295u);
    bool loop_init_6 = true;
    while(true) {
        if (metal::all(loop_bound_6 == uint2(0u))) { break; }
        loop_bound_6 -= uint2(loop_bound_6.y == 0u, 1u);
        if (!loop_init_6) {
            uint _e44 = i;
            i = _e44 - 1u;
        }
        loop_init_6 = false;
        uint _e12 = i;
        if (_e12 > 0u) {
        } else {
            break;
        }
        {
            uint _e17 = i;
            Draw d_1 = draws[(job.first + _e17) - 1u];
            if (!(metal::any(t_2 < d_1.rect.xy))) {
                local = metal::any(t_2 >= d_1.rect.zw);
            } else {
                local = true;
            }
            bool _e35 = local;
            if (_e35) {
                continue;
            }
            metal::float2 _e36 = sample(d_1, t_2, pool);
            if (_e36.y > 0.0) {
                result = metal::float2(_e36.x, d_1.rank);
                break;
            }
        }
    }
    metal::float2 _e50 = result;
    store.write(metal::float4(_e50, 0.0, 0.0), metal::uint2(static_cast<metal::int2>(job.origin + t_2)));
    return;
}
