// language: metal2.3
#include <metal_stdlib>
#include <simd/simd.h>

using metal::uint;

struct CspCtx {
    metal::int2 p;
    float height;
    float base;
    float dx;
    float dy;
    float sdx;
    float sdy;
    float res;
    float slope;
    float aspect;
    char _pad10[4];
};
struct type_18 {
    metal::float4 inner[4];
};
struct type_19 {
    metal::float4 inner[12];
};
struct type_20 {
    metal::float4 inner[40];
};
struct CskUniforms {
    int u_style;
    float csk_pad_u_style_1_;
    float csk_pad_u_style_2_;
    float csk_pad_u_style_3_;
    float u_terrainOpacity;
    float csk_pad_u_terrainOpacity_1_;
    float csk_pad_u_terrainOpacity_2_;
    float csk_pad_u_terrainOpacity_3_;
    float u_sunAzimuth;
    float csk_pad_u_sunAzimuth_1_;
    float csk_pad_u_sunAzimuth_2_;
    float csk_pad_u_sunAzimuth_3_;
    float u_sunAltitude;
    float csk_pad_u_sunAltitude_1_;
    float csk_pad_u_sunAltitude_2_;
    float csk_pad_u_sunAltitude_3_;
    float u_ambient;
    float csk_pad_u_ambient_1_;
    float csk_pad_u_ambient_2_;
    float csk_pad_u_ambient_3_;
    float u_lookSaturation;
    float csk_pad_u_lookSaturation_1_;
    float csk_pad_u_lookSaturation_2_;
    float csk_pad_u_lookSaturation_3_;
    float u_lookContrast;
    float csk_pad_u_lookContrast_1_;
    float csk_pad_u_lookContrast_2_;
    float csk_pad_u_lookContrast_3_;
    float u_lookBrightness;
    float csk_pad_u_lookBrightness_1_;
    float csk_pad_u_lookBrightness_2_;
    float csk_pad_u_lookBrightness_3_;
    float u_spectrumOn;
    float csk_pad_u_spectrumOn_1_;
    float csk_pad_u_spectrumOn_2_;
    float csk_pad_u_spectrumOn_3_;
    float u_spectrumLevel;
    float csk_pad_u_spectrumLevel_1_;
    float csk_pad_u_spectrumLevel_2_;
    float csk_pad_u_spectrumLevel_3_;
    float u_spectrumSpan;
    float csk_pad_u_spectrumSpan_1_;
    float csk_pad_u_spectrumSpan_2_;
    float csk_pad_u_spectrumSpan_3_;
    float u_spectrumAlpha;
    float csk_pad_u_spectrumAlpha_1_;
    float csk_pad_u_spectrumAlpha_2_;
    float csk_pad_u_spectrumAlpha_3_;
    metal::packed_float3 u_spectrumLow;
    float csk_pad_u_spectrumLow_3_;
    metal::packed_float3 u_spectrumMid;
    float csk_pad_u_spectrumMid_3_;
    metal::packed_float3 u_spectrumHigh;
    float csk_pad_u_spectrumHigh_3_;
    float u_belowOn;
    float csk_pad_u_belowOn_1_;
    float csk_pad_u_belowOn_2_;
    float csk_pad_u_belowOn_3_;
    float u_belowLevel;
    float csk_pad_u_belowLevel_1_;
    float csk_pad_u_belowLevel_2_;
    float csk_pad_u_belowLevel_3_;
    metal::packed_float3 u_belowColor;
    float csk_pad_u_belowColor_3_;
    float u_aboveOn;
    float csk_pad_u_aboveOn_1_;
    float csk_pad_u_aboveOn_2_;
    float csk_pad_u_aboveOn_3_;
    float u_aboveLevel;
    float csk_pad_u_aboveLevel_1_;
    float csk_pad_u_aboveLevel_2_;
    float csk_pad_u_aboveLevel_3_;
    metal::packed_float3 u_aboveColor;
    float csk_pad_u_aboveColor_3_;
    float u_bandAlpha;
    float csk_pad_u_bandAlpha_1_;
    float csk_pad_u_bandAlpha_2_;
    float csk_pad_u_bandAlpha_3_;
    float u_bandFeather;
    float csk_pad_u_bandFeather_1_;
    float csk_pad_u_bandFeather_2_;
    float csk_pad_u_bandFeather_3_;
    float u_outlineOn;
    float csk_pad_u_outlineOn_1_;
    float csk_pad_u_outlineOn_2_;
    float csk_pad_u_outlineOn_3_;
    float u_outlineWidth;
    float csk_pad_u_outlineWidth_1_;
    float csk_pad_u_outlineWidth_2_;
    float csk_pad_u_outlineWidth_3_;
    float u_spectrumOpacity;
    float csk_pad_u_spectrumOpacity_1_;
    float csk_pad_u_spectrumOpacity_2_;
    float csk_pad_u_spectrumOpacity_3_;
    metal::float2 u_centerMerc;
    float csk_pad_u_centerMerc_2_;
    float csk_pad_u_centerMerc_3_;
    float u_zoom;
    float csk_pad_u_zoom_1_;
    float csk_pad_u_zoom_2_;
    float csk_pad_u_zoom_3_;
    float u_bearingRad;
    float csk_pad_u_bearingRad_1_;
    float csk_pad_u_bearingRad_2_;
    float csk_pad_u_bearingRad_3_;
    metal::float2 u_cssSize;
    float csk_pad_u_cssSize_2_;
    float csk_pad_u_cssSize_3_;
    float u_dpr;
    float csk_pad_u_dpr_1_;
    float csk_pad_u_dpr_2_;
    float csk_pad_u_dpr_3_;
    float u_groundResOverride;
    float csk_pad_u_groundResOverride_1_;
    float csk_pad_u_groundResOverride_2_;
    float csk_pad_u_groundResOverride_3_;
    float u_stackOn;
    float csk_pad_u_stackOn_1_;
    float csk_pad_u_stackOn_2_;
    float csk_pad_u_stackOn_3_;
    float u_stackGradient;
    float csk_pad_u_stackGradient_1_;
    float csk_pad_u_stackGradient_2_;
    float csk_pad_u_stackGradient_3_;
    float u_layerCount;
    float csk_pad_u_layerCount_1_;
    float csk_pad_u_layerCount_2_;
    float csk_pad_u_layerCount_3_;
    type_18 u_layerA;
    type_18 u_layerB;
    type_18 u_layerC;
    type_18 u_layerD;
    type_19 u_layerPos;
    type_20 u_layerColors;
    float u_detail;
    float csk_pad_u_detail_1_;
    float csk_pad_u_detail_2_;
    float csk_pad_u_detail_3_;
    float u_reliefExag;
    float csk_pad_u_reliefExag_1_;
    float csk_pad_u_reliefExag_2_;
    float csk_pad_u_reliefExag_3_;
    float u_remFlatBase;
    float csk_pad_u_remFlatBase_1_;
    float csk_pad_u_remFlatBase_2_;
    float csk_pad_u_remFlatBase_3_;
    float u_remLandBase;
    float csk_pad_u_remLandBase_1_;
    float csk_pad_u_remLandBase_2_;
    float csk_pad_u_remLandBase_3_;
};

metal::float3 cspApplyAppearance_u0028_vf3_u003b(
    thread metal::float3& straight,
    constant CskUniforms& unnamed
) {
    float s = {};
    metal::float3 c = {};
    float _e264 = unnamed.u_lookSaturation;
    s = _e264;
    float _e265 = s;
    float _e269 = straight[0u];
    float _e271 = s;
    float _e275 = straight[1u];
    float _e278 = s;
    float _e282 = straight[2u];
    float _e285 = s;
    float _e289 = straight[0u];
    float _e291 = s;
    float _e295 = straight[1u];
    float _e298 = s;
    float _e302 = straight[2u];
    float _e305 = s;
    float _e309 = straight[0u];
    float _e311 = s;
    float _e315 = straight[1u];
    float _e318 = s;
    float _e322 = straight[2u];
    c = metal::float3((((0.213 + (0.787 * _e265)) * _e269) + ((0.715 - (0.715 * _e271)) * _e275)) + ((0.072 - (0.072 * _e278)) * _e282), (((0.213 - (0.213 * _e285)) * _e289) + ((0.715 + (0.285 * _e291)) * _e295)) + ((0.072 - (0.072 * _e298)) * _e302), (((0.213 - (0.213 * _e305)) * _e309) + ((0.715 - (0.715 * _e311)) * _e315)) + ((0.072 + (0.928 * _e318)) * _e322));
    metal::float3 _e326 = c;
    c = metal::clamp(_e326, metal::float3(0.0), metal::float3(1.0));
    metal::float3 _e330 = c;
    float _e332 = unnamed.u_lookContrast;
    float _e335 = unnamed.u_lookContrast;
    c = metal::clamp((_e330 * _e332) + metal::float3((1.0 - _e335) * 0.5), metal::float3(0.0), metal::float3(1.0));
    metal::float3 _e343 = c;
    float _e345 = unnamed.u_lookBrightness;
    c = metal::clamp(_e343 * _e345, metal::float3(0.0), metal::float3(1.0));
    metal::float3 _e350 = c;
    return _e350;
}

metal::float3 cspTintColour_u0028_f1_u003b(
    thread float& value
) {
    metal::float3 c0_ = {};
    metal::float3 c1_ = {};
    metal::float3 c2_ = {};
    metal::float3 c3_ = {};
    metal::float3 c4_ = {};
    metal::float3 c5_ = {};
    metal::float3 c6_ = {};
    metal::float3 c7_ = {};
    c0_ = metal::float3(0.08627451, 0.18039216, 0.28235295);
    c1_ = metal::float3(0.15686275, 0.27450982, 0.37254903);
    c2_ = metal::float3(0.27450982, 0.43137255, 0.27450982);
    c3_ = metal::float3(0.5019608, 0.54901963, 0.36078432);
    c4_ = metal::float3(0.627451, 0.54901963, 0.42352942);
    c5_ = metal::float3(0.74509805, 0.7058824, 0.6666667);
    c6_ = metal::float3(0.9607843, 0.9647059, 0.98039216);
    c7_ = metal::float3(1.0, 1.0, 1.0);
    float _e269 = value;
    if (_e269 <= -500.0) {
        metal::float3 _e271 = c0_;
        return _e271;
    }
    float _e272 = value;
    if (_e272 <= 0.0) {
        metal::float3 _e274 = c0_;
        metal::float3 _e275 = c1_;
        float _e276 = value;
        return metal::mix(_e274, _e275, metal::float3((_e276 + 500.0) / 500.0));
    }
    float _e281 = value;
    if (_e281 <= 300.0) {
        metal::float3 _e283 = c1_;
        metal::float3 _e284 = c2_;
        float _e285 = value;
        return metal::mix(_e283, _e284, metal::float3(_e285 / 300.0));
    }
    float _e289 = value;
    if (_e289 <= 900.0) {
        metal::float3 _e291 = c2_;
        metal::float3 _e292 = c3_;
        float _e293 = value;
        return metal::mix(_e291, _e292, metal::float3((_e293 - 300.0) / 600.0));
    }
    float _e298 = value;
    if (_e298 <= 1600.0) {
        metal::float3 _e300 = c3_;
        metal::float3 _e301 = c4_;
        float _e302 = value;
        return metal::mix(_e300, _e301, metal::float3((_e302 - 900.0) / 700.0));
    }
    float _e307 = value;
    if (_e307 <= 2400.0) {
        metal::float3 _e309 = c4_;
        metal::float3 _e310 = c5_;
        float _e311 = value;
        return metal::mix(_e309, _e310, metal::float3((_e311 - 1600.0) / 800.0));
    }
    float _e316 = value;
    if (_e316 <= 3200.0) {
        metal::float3 _e318 = c5_;
        metal::float3 _e319 = c6_;
        float _e320 = value;
        return metal::mix(_e318, _e319, metal::float3((_e320 - 2400.0) / 800.0));
    }
    float _e325 = value;
    if (_e325 <= 6000.0) {
        metal::float3 _e327 = c6_;
        metal::float3 _e328 = c7_;
        float _e329 = value;
        return metal::mix(_e327, _e328, metal::float3((_e329 - 3200.0) / 2800.0));
    }
    metal::float3 _e334 = c7_;
    return _e334;
}

float cspDirectShade_u0028_f1_u003b_f1_u003b_f1_u003b(
    thread float& dx,
    thread float& dy,
    thread float& azimuth,
    constant CskUniforms& unnamed
) {
    float east = {};
    float north = {};
    float altitude = {};
    float az = {};
    float _e267 = dx;
    east = _e267;
    float _e268 = dy;
    north = -(_e268);
    float _e271 = unnamed.u_sunAltitude;
    altitude = ((_e271) * 0.017453292519943295474);
    float _e273 = azimuth;
    az = ((_e273) * 0.017453292519943295474);
    float _e275 = east;
    float _e277 = altitude;
    float _e280 = az;
    float _e283 = north;
    float _e284 = altitude;
    float _e287 = az;
    float _e291 = altitude;
    float _e294 = east;
    float _e295 = east;
    float _e297 = north;
    float _e298 = north;
    return metal::clamp(((((-(_e275) * metal::cos(_e277)) * metal::sin(_e280)) - ((_e283 * metal::cos(_e284)) * metal::cos(_e287))) + metal::sin(_e291)) / metal::sqrt(((_e294 * _e295) + (_e297 * _e298)) + 1.0), 0.0, 1.0);
}

metal::float3 cspAspectColour_u0028_f1_u003b(
    thread float& degreesValue
) {
    float sector = {};
    float t = {};
    metal::float3 a = {};
    metal::float3 b = {};
    float _e265 = degreesValue;
    sector = metal::floor(_e265 / 45.0);
    float _e268 = degreesValue;
    t = metal::fract(_e268 / 45.0);
    float _e271 = sector;
    if (_e271 < 1.0) {
        a = metal::float3(77.0, 120.0, 200.0);
        b = metal::float3(59.0, 165.0, 176.0);
    } else {
        float _e273 = sector;
        if (_e273 < 2.0) {
            a = metal::float3(59.0, 165.0, 176.0);
            b = metal::float3(87.0, 167.0, 101.0);
        } else {
            float _e275 = sector;
            if (_e275 < 3.0) {
                a = metal::float3(87.0, 167.0, 101.0);
                b = metal::float3(201.0, 173.0, 79.0);
            } else {
                float _e277 = sector;
                if (_e277 < 4.0) {
                    a = metal::float3(201.0, 173.0, 79.0);
                    b = metal::float3(217.0, 107.0, 82.0);
                } else {
                    float _e279 = sector;
                    if (_e279 < 5.0) {
                        a = metal::float3(217.0, 107.0, 82.0);
                        b = metal::float3(196.0, 91.0, 130.0);
                    } else {
                        float _e281 = sector;
                        if (_e281 < 6.0) {
                            a = metal::float3(196.0, 91.0, 130.0);
                            b = metal::float3(141.0, 101.0, 187.0);
                        } else {
                            float _e283 = sector;
                            if (_e283 < 7.0) {
                                a = metal::float3(141.0, 101.0, 187.0);
                                b = metal::float3(94.0, 119.0, 197.0);
                            } else {
                                a = metal::float3(94.0, 119.0, 197.0);
                                b = metal::float3(77.0, 120.0, 200.0);
                            }
                        }
                    }
                }
            }
        }
    }
    metal::float3 _e285 = a;
    metal::float3 _e286 = b;
    float _e287 = t;
    return metal::mix(_e285, _e286, metal::float3(_e287)) / metal::float3(255.0);
}

float cspAspectOf_u0028_f1_u003b_f1_u003b(
    thread float& dx_1,
    thread float& dy_1
) {
    float _e262 = dx_1;
    float _e264 = dy_1;
    float _e267 = ((metal::atan2(-(_e262), _e264)) * 57.295779513082322865) + 360.0;
    return _e267 - (metal::floor(_e267 / 360.0) * 360.0);
}

metal::float3 cspRamp_u0028_f1_u003b_vf3_u003b_f1_u003b_vf3_u003b_f1_u003b_vf3_u003b_f1_u003b_vf3_u003b_f1_u003b_vf3_u003b_f1_u003b_vf3_u003b_f1_u003b_vf3_u003b(
    thread float& value_1,
    thread metal::float3& c0_1,
    thread float& v1_,
    thread metal::float3& c1_1,
    thread float& v2_,
    thread metal::float3& c2_1,
    thread float& v3_,
    thread metal::float3& c3_1,
    thread float& v4_,
    thread metal::float3& c4_1,
    thread float& v5_,
    thread metal::float3& c5_1,
    thread float& v6_,
    thread metal::float3& c6_1
) {
    float _e274 = value_1;
    float _e275 = v1_;
    if (_e274 <= _e275) {
        metal::float3 _e277 = c0_1;
        metal::float3 _e278 = c1_1;
        float _e279 = value_1;
        float _e280 = v1_;
        return metal::mix(_e277, _e278, metal::float3(metal::clamp(_e279 / metal::max(_e280, 0.0001), 0.0, 1.0)));
    }
    float _e286 = value_1;
    float _e287 = v2_;
    if (_e286 <= _e287) {
        metal::float3 _e289 = c1_1;
        metal::float3 _e290 = c2_1;
        float _e291 = value_1;
        float _e292 = v1_;
        float _e294 = v2_;
        float _e295 = v1_;
        return metal::mix(_e289, _e290, metal::float3((_e291 - _e292) / (_e294 - _e295)));
    }
    float _e300 = value_1;
    float _e301 = v3_;
    if (_e300 <= _e301) {
        metal::float3 _e303 = c2_1;
        metal::float3 _e304 = c3_1;
        float _e305 = value_1;
        float _e306 = v2_;
        float _e308 = v3_;
        float _e309 = v2_;
        return metal::mix(_e303, _e304, metal::float3((_e305 - _e306) / (_e308 - _e309)));
    }
    float _e314 = value_1;
    float _e315 = v4_;
    if (_e314 <= _e315) {
        metal::float3 _e317 = c3_1;
        metal::float3 _e318 = c4_1;
        float _e319 = value_1;
        float _e320 = v3_;
        float _e322 = v4_;
        float _e323 = v3_;
        return metal::mix(_e317, _e318, metal::float3((_e319 - _e320) / (_e322 - _e323)));
    }
    float _e328 = value_1;
    float _e329 = v5_;
    if (_e328 <= _e329) {
        metal::float3 _e331 = c4_1;
        metal::float3 _e332 = c5_1;
        float _e333 = value_1;
        float _e334 = v4_;
        float _e336 = v5_;
        float _e337 = v4_;
        return metal::mix(_e331, _e332, metal::float3((_e333 - _e334) / (_e336 - _e337)));
    }
    float _e342 = value_1;
    float _e343 = v6_;
    if (_e342 <= _e343) {
        metal::float3 _e345 = c5_1;
        metal::float3 _e346 = c6_1;
        float _e347 = value_1;
        float _e348 = v5_;
        float _e350 = v6_;
        float _e351 = v5_;
        return metal::mix(_e345, _e346, metal::float3((_e347 - _e348) / (_e350 - _e351)));
    }
    metal::float3 _e356 = c6_1;
    return _e356;
}

metal::float3 cspSlopeColour_u0028_f1_u003b(
    thread float& degreesValue_1
) {
    float param = {};
    metal::float3 param_1 = {};
    float param_2 = {};
    metal::float3 param_3 = {};
    float param_4 = {};
    metal::float3 param_5 = {};
    float param_6 = {};
    metal::float3 param_7 = {};
    float param_8 = {};
    metal::float3 param_9 = {};
    float param_10 = {};
    metal::float3 param_11 = {};
    float param_12 = {};
    metal::float3 param_13 = {};
    float _e275 = degreesValue_1;
    param = _e275;
    param_1 = metal::float3(0.9490196, 0.95686275, 0.93333334);
    param_2 = 5.0;
    param_3 = metal::float3(0.69411767, 0.8235294, 0.54509807);
    param_4 = 15.0;
    param_5 = metal::float3(0.9647059, 0.85490197, 0.43529412);
    param_6 = 30.0;
    param_7 = metal::float3(0.9411765, 0.5882353, 0.28627452);
    param_8 = 45.0;
    param_9 = metal::float3(0.8352941, 0.27450982, 0.3137255);
    param_10 = 60.0;
    param_11 = metal::float3(0.4627451, 0.17254902, 0.4117647);
    param_12 = 90.0;
    param_13 = metal::float3(0.19607843, 0.09803922, 0.28235295);
    metal::float3 _e276 = cspRamp_u0028_f1_u003b_vf3_u003b_f1_u003b_vf3_u003b_f1_u003b_vf3_u003b_f1_u003b_vf3_u003b_f1_u003b_vf3_u003b_f1_u003b_vf3_u003b_f1_u003b_vf3_u003b(param, param_1, param_2, param_3, param_4, param_5, param_6, param_7, param_8, param_9, param_10, param_11, param_12, param_13);
    return _e276;
}

float cspLum_u0028_vf3_u003b(
    thread metal::float3& c_1
) {
    metal::float3 _e261 = c_1;
    return metal::dot(_e261, metal::float3(0.3, 0.59, 0.11));
}

metal::float3 cspClipColour_u0028_vf3_u003b(
    thread metal::float3& c_2
) {
    float l = {};
    metal::float3 param_14 = {};
    float n = {};
    float x = {};
    metal::float3 _e265 = c_2;
    param_14 = _e265;
    float _e266 = cspLum_u0028_vf3_u003b(param_14);
    l = _e266;
    float _e268 = c_2[0u];
    float _e270 = c_2[1u];
    float _e273 = c_2[2u];
    n = metal::min(metal::min(_e268, _e270), _e273);
    float _e276 = c_2[0u];
    float _e278 = c_2[1u];
    float _e281 = c_2[2u];
    x = metal::max(metal::max(_e276, _e278), _e281);
    float _e283 = n;
    if (_e283 < 0.0) {
        float _e285 = l;
        metal::float3 _e286 = c_2;
        float _e287 = l;
        float _e290 = l;
        float _e292 = l;
        float _e293 = n;
        c_2 = metal::float3(_e285) + (((_e286 - metal::float3(_e287)) * _e290) / metal::float3(metal::max(_e292 - _e293, 0.000001)));
    }
    float _e300 = x;
    if (_e300 > 1.0) {
        float _e302 = l;
        metal::float3 _e303 = c_2;
        float _e304 = l;
        float _e307 = l;
        float _e310 = x;
        float _e311 = l;
        c_2 = metal::float3(_e302) + (((_e303 - metal::float3(_e304)) * (1.0 - _e307)) / metal::float3(metal::max(_e310 - _e311, 0.000001)));
    }
    metal::float3 _e318 = c_2;
    return _e318;
}

metal::float3 cspSetLum_u0028_vf3_u003b_f1_u003b(
    thread metal::float3& c_3,
    thread float& l_1
) {
    metal::float3 param_15 = {};
    metal::float3 param_16 = {};
    metal::float3 _e264 = c_3;
    float _e265 = l_1;
    metal::float3 _e266 = c_3;
    param_15 = _e266;
    float _e267 = cspLum_u0028_vf3_u003b(param_15);
    param_16 = _e264 + metal::float3(_e265 - _e267);
    metal::float3 _e271 = cspClipColour_u0028_vf3_u003b(param_16);
    return _e271;
}

metal::float3 cspSoftLight_u0028_vf3_u003b_vf3_u003b(
    thread metal::float3& b_1,
    thread metal::float3& s_1
) {
    metal::float3 d = {};
    metal::float3 _e263 = b_1;
    metal::float3 _e267 = b_1;
    metal::float3 _e271 = b_1;
    metal::float3 _e273 = b_1;
    metal::float3 _e275 = b_1;
    d = metal::mix(((((_e263 * 16.0) - metal::float3(12.0)) * _e267) + metal::float3(4.0)) * _e271, metal::sqrt(_e273), metal::step(metal::float3(0.25), _e275));
    metal::float3 _e279 = b_1;
    metal::float3 _e280 = s_1;
    metal::float3 _e284 = b_1;
    metal::float3 _e286 = b_1;
    metal::float3 _e291 = b_1;
    metal::float3 _e292 = s_1;
    metal::float3 _e296 = d;
    metal::float3 _e297 = b_1;
    metal::float3 _e301 = s_1;
    return metal::mix(_e279 - (((metal::float3(1.0) - (_e280 * 2.0)) * _e284) * (metal::float3(1.0) - _e286)), _e291 + (((_e292 * 2.0) - metal::float3(1.0)) * (_e296 - _e297)), metal::step(metal::float3(0.5), _e301));
}

metal::float3 cspHardLight_u0028_vf3_u003b_vf3_u003b(
    thread metal::float3& b_2,
    thread metal::float3& s_2
) {
    metal::float3 _e262 = b_2;
    metal::float3 _e264 = s_2;
    metal::float3 _e266 = b_2;
    metal::float3 _e269 = s_2;
    metal::float3 _e278 = s_2;
    return metal::mix((_e262 * 2.0) * _e264, metal::float3(1.0) - ((metal::float3(1.0) - _e266) * (metal::float3(1.0) - ((_e269 * 2.0) - metal::float3(1.0)))), metal::step(metal::float3(0.5), _e278));
}

metal::float3 cspBlendMode_u0028_i1_u003b_vf3_u003b_vf3_u003b(
    thread int& mode,
    thread metal::float3& b_3,
    thread metal::float3& s_3
) {
    metal::float3 param_17 = {};
    metal::float3 param_18 = {};
    metal::float3 param_19 = {};
    metal::float3 param_20 = {};
    metal::float3 param_21 = {};
    metal::float3 param_22 = {};
    metal::float3 param_23 = {};
    metal::float3 param_24 = {};
    float param_25 = {};
    metal::float3 param_26 = {};
    metal::float3 param_27 = {};
    float param_28 = {};
    int _e275 = mode;
    if (_e275 == 1) {
        metal::float3 _e277 = b_3;
        metal::float3 _e278 = s_3;
        return _e277 * _e278;
    }
    int _e280 = mode;
    if (_e280 == 2) {
        metal::float3 _e282 = b_3;
        metal::float3 _e283 = s_3;
        metal::float3 _e285 = b_3;
        metal::float3 _e286 = s_3;
        return (_e282 + _e283) - (_e285 * _e286);
    }
    int _e289 = mode;
    if (_e289 == 3) {
        metal::float3 _e291 = s_3;
        param_17 = _e291;
        metal::float3 _e292 = b_3;
        param_18 = _e292;
        metal::float3 _e293 = cspHardLight_u0028_vf3_u003b_vf3_u003b(param_17, param_18);
        return _e293;
    }
    int _e294 = mode;
    if (_e294 == 4) {
        metal::float3 _e296 = b_3;
        param_19 = _e296;
        metal::float3 _e297 = s_3;
        param_20 = _e297;
        metal::float3 _e298 = cspSoftLight_u0028_vf3_u003b_vf3_u003b(param_19, param_20);
        return _e298;
    }
    int _e299 = mode;
    if (_e299 == 5) {
        metal::float3 _e301 = b_3;
        param_21 = _e301;
        metal::float3 _e302 = s_3;
        param_22 = _e302;
        metal::float3 _e303 = cspHardLight_u0028_vf3_u003b_vf3_u003b(param_21, param_22);
        return _e303;
    }
    int _e304 = mode;
    if (_e304 == 6) {
        metal::float3 _e306 = b_3;
        metal::float3 _e307 = s_3;
        return metal::min(_e306, _e307);
    }
    int _e309 = mode;
    if (_e309 == 7) {
        metal::float3 _e311 = b_3;
        metal::float3 _e312 = s_3;
        return metal::max(_e311, _e312);
    }
    int _e314 = mode;
    if (_e314 == 8) {
        metal::float3 _e316 = b_3;
        param_23 = _e316;
        float _e317 = cspLum_u0028_vf3_u003b(param_23);
        metal::float3 _e318 = s_3;
        param_24 = _e318;
        param_25 = _e317;
        metal::float3 _e319 = cspSetLum_u0028_vf3_u003b_f1_u003b(param_24, param_25);
        return _e319;
    }
    int _e320 = mode;
    if (_e320 == 9) {
        metal::float3 _e322 = s_3;
        param_26 = _e322;
        float _e323 = cspLum_u0028_vf3_u003b(param_26);
        metal::float3 _e324 = b_3;
        param_27 = _e324;
        param_28 = _e323;
        metal::float3 _e325 = cspSetLum_u0028_vf3_u003b_f1_u003b(param_27, param_28);
        return _e325;
    }
    metal::float3 _e326 = s_3;
    return _e326;
}

metal::float4 cspComposite_u0028_vf4_u003b_vf3_u003b_f1_u003b_i1_u003b(
    thread metal::float4& backdrop,
    thread metal::float3& s_4,
    thread float& as,
    thread int& mode_1
) {
    float ab = {};
    metal::float3 b_4 = {};
    metal::float3 local = {};
    metal::float3 mixed = {};
    int param_29 = {};
    metal::float3 param_30 = {};
    metal::float3 param_31 = {};
    float _e272 = backdrop[3u];
    ab = _e272;
    float _e273 = ab;
    if (_e273 > 0.0) {
        metal::float4 _e275 = backdrop;
        float _e277 = ab;
        local = _e275.xyz / metal::float3(_e277);
    } else {
        local = metal::float3(0.0, 0.0, 0.0);
    }
    metal::float3 _e280 = local;
    b_4 = _e280;
    float _e281 = ab;
    metal::float3 _e283 = s_4;
    float _e285 = ab;
    int _e286 = mode_1;
    param_29 = _e286;
    metal::float3 _e287 = b_4;
    param_30 = _e287;
    metal::float3 _e288 = s_4;
    param_31 = _e288;
    metal::float3 _e289 = cspBlendMode_u0028_i1_u003b_vf3_u003b_vf3_u003b(param_29, param_30, param_31);
    mixed = (_e283 * (1.0 - _e281)) + (metal::clamp(_e289, metal::float3(0.0), metal::float3(1.0)) * _e285);
    float _e295 = as;
    metal::float3 _e296 = mixed;
    float _e298 = as;
    metal::float4 _e300 = backdrop;
    metal::float3 _e303 = (_e296 * _e295) + (_e300.xyz * (1.0 - _e298));
    float _e304 = as;
    float _e305 = ab;
    float _e306 = as;
    return metal::float4(_e303.x, _e303.y, _e303.z, _e304 + (_e305 * (1.0 - _e306)));
}

int naga_div(int lhs, int rhs) {
    return lhs / metal::select(rhs, 1, (lhs == (-2147483647 - 1) & rhs == -1) | (rhs == 0));
}

float cspStopPos_u0028_i1_u003b_i1_u003b(
    thread int& layer,
    thread int& k,
    constant CskUniforms& unnamed
) {
    metal::float4 v = {};
    int m = {};
    float local_1 = {};
    float local_2 = {};
    float local_3 = {};
    int _e267 = layer;
    int _e269 = k;
    metal::float4 _e274 = unnamed.u_layerPos.inner[as_type<int>(as_type<uint>(as_type<int>(as_type<uint>(_e267) * as_type<uint>(3))) + as_type<uint>(naga_div(_e269, 4)))];
    v = _e274;
    int _e275 = k;
    int _e276 = k;
    m = as_type<int>(as_type<uint>(_e275) - as_type<uint>(as_type<int>(as_type<uint>(naga_div(_e276, 4)) * as_type<uint>(4))));
    int _e280 = m;
    if (_e280 == 0) {
        float _e283 = v[0u];
        local_1 = _e283;
    } else {
        int _e284 = m;
        if (_e284 == 1) {
            float _e287 = v[1u];
            local_2 = _e287;
        } else {
            int _e288 = m;
            if (_e288 == 2) {
                float _e291 = v[2u];
                local_3 = _e291;
            } else {
                float _e293 = v[3u];
                local_3 = _e293;
            }
            float _e294 = local_3;
            local_2 = _e294;
        }
        float _e295 = local_2;
        local_1 = _e295;
    }
    float _e296 = local_1;
    return _e296;
}

int naga_f2i32(float value) {
    return static_cast<int>(metal::clamp(value, -2147483600.0, 2147483500.0));
}

metal::float4 cspRampAt_u0028_i1_u003b_f1_u003b(
    thread int& layer_1,
    thread float& t_1,
    constant CskUniforms& unnamed
) {
    int count = {};
    int base = {};
    int param_32 = {};
    int param_33 = {};
    int k_1 = {};
    float p1_ = {};
    int param_34 = {};
    int param_35 = {};
    float p0_ = {};
    int param_36 = {};
    int param_37 = {};
    bool phi_1293_ = {};
    int _e273 = layer_1;
    float _e277 = unnamed.u_layerA.inner[_e273][3u];
    count = naga_f2i32(_e277 + 0.5);
    int _e280 = layer_1;
    base = as_type<int>(as_type<uint>(_e280) * as_type<uint>(10));
    int _e282 = count;
    bool _e283 = _e282 <= 1;
    phi_1293_ = _e283;
    if (!(_e283)) {
        float _e285 = t_1;
        int _e286 = layer_1;
        param_32 = _e286;
        param_33 = 0;
        float _e287 = cspStopPos_u0028_i1_u003b_i1_u003b(param_32, param_33, unnamed);
        phi_1293_ = _e285 <= _e287;
    }
    bool _e290 = phi_1293_;
    if (_e290) {
        int _e291 = base;
        metal::float4 _e294 = unnamed.u_layerColors.inner[_e291];
        return _e294;
    }
    k_1 = 1;
    uint2 loop_bound = uint2(4294967295u);
    bool loop_init = true;
    while(true) {
        if (metal::all(loop_bound == uint2(0u))) { break; }
        loop_bound -= uint2(loop_bound.y == 0u, 1u);
        if (!loop_init) {
            int _e334 = k_1;
            k_1 = as_type<int>(as_type<uint>(_e334) + as_type<uint>(1));
        }
        loop_init = false;
        int _e295 = k_1;
        if (_e295 < 10) {
            int _e297 = k_1;
            int _e298 = count;
            if (_e297 >= _e298) {
                break;
            }
            int _e300 = layer_1;
            param_34 = _e300;
            int _e301 = k_1;
            param_35 = _e301;
            float _e302 = cspStopPos_u0028_i1_u003b_i1_u003b(param_34, param_35, unnamed);
            p1_ = _e302;
            float _e303 = t_1;
            float _e304 = p1_;
            if (_e303 <= _e304) {
                int _e306 = k_1;
                int _e308 = layer_1;
                param_36 = _e308;
                param_37 = as_type<int>(as_type<uint>(_e306) - as_type<uint>(1));
                float _e309 = cspStopPos_u0028_i1_u003b_i1_u003b(param_36, param_37, unnamed);
                p0_ = _e309;
                int _e310 = base;
                int _e311 = k_1;
                metal::float4 _e316 = unnamed.u_layerColors.inner[as_type<int>(as_type<uint>(as_type<int>(as_type<uint>(_e310) + as_type<uint>(_e311))) - as_type<uint>(1))];
                int _e317 = base;
                int _e318 = k_1;
                metal::float4 _e322 = unnamed.u_layerColors.inner[as_type<int>(as_type<uint>(_e317) + as_type<uint>(_e318))];
                float _e323 = t_1;
                float _e324 = p0_;
                float _e326 = p1_;
                float _e327 = p0_;
                return metal::mix(_e316, _e322, metal::float4(metal::clamp((_e323 - _e324) / metal::max(_e326 - _e327, 0.000001), 0.0, 1.0)));
            }
            continue;
        } else {
            break;
        }
    }
    int _e336 = base;
    int _e337 = count;
    metal::float4 _e342 = unnamed.u_layerColors.inner[as_type<int>(as_type<uint>(as_type<int>(as_type<uint>(_e336) + as_type<uint>(_e337))) - as_type<uint>(1))];
    return _e342;
}

metal::float4 cspPaletteRange_u0028_i1_u003b_f1_u003b_vf2_u003b(
    thread int& layer_2,
    thread float& value_2,
    thread metal::float2& range,
    constant CskUniforms& unnamed
) {
    metal::float4 r = {};
    float t_2 = {};
    int param_38 = {};
    float param_39 = {};
    int _e267 = layer_2;
    metal::float4 _e270 = unnamed.u_layerB.inner[_e267];
    r = _e270;
    float _e271 = value_2;
    float _e273 = range[0u];
    float _e276 = range[1u];
    float _e278 = range[0u];
    t_2 = metal::clamp((_e271 - _e273) / metal::max(_e276 - _e278, 0.000001), 0.0, 1.0);
    float _e283 = t_2;
    float _e286 = r[2u];
    t_2 = metal::pow(metal::max(_e283, 0.0), _e286);
    float _e289 = r[3u];
    if (_e289 >= 2.0) {
        float _e291 = t_2;
        float _e293 = r[3u];
        float _e297 = r[3u];
        float _e301 = r[3u];
        t_2 = metal::min(metal::floor(_e291 * _e293), _e297 - 1.0) / (_e301 - 1.0);
    }
    int _e304 = layer_2;
    param_38 = _e304;
    float _e305 = t_2;
    param_39 = _e305;
    metal::float4 _e306 = cspRampAt_u0028_i1_u003b_f1_u003b(param_38, param_39, unnamed);
    return _e306;
}

metal::float4 cspPalette_u0028_i1_u003b_f1_u003b(
    thread int& layer_3,
    thread float& value_3,
    constant CskUniforms& unnamed
) {
    int param_40 = {};
    float param_41 = {};
    metal::float2 param_42 = {};
    int _e265 = layer_3;
    int _e266 = layer_3;
    param_40 = _e266;
    float _e267 = value_3;
    param_41 = _e267;
    metal::float4 _e270 = unnamed.u_layerB.inner[_e265];
    param_42 = _e270.xy;
    metal::float4 _e272 = cspPaletteRange_u0028_i1_u003b_f1_u003b_vf2_u003b(param_40, param_41, param_42, unnamed);
    return _e272;
}

metal::float4 cspWaterColour_u0028_i1_u003b_f1_u003b_vf2_u003b(
    thread int& layer_4,
    thread float& value_4,
    thread metal::float2& range_1,
    constant CskUniforms& unnamed
) {
    float t_3 = {};
    metal::float4 r_1 = {};
    metal::float3 deep = {};
    metal::float3 mid = {};
    metal::float3 shallow = {};
    metal::float3 local_4 = {};
    int param_43 = {};
    float param_44 = {};
    float _e271 = value_4;
    float _e273 = range_1[0u];
    float _e276 = range_1[1u];
    float _e278 = range_1[0u];
    t_3 = metal::clamp((_e271 - _e273) / metal::max(0.000001, _e276 - _e278), 0.0, 1.0);
    int _e283 = layer_4;
    metal::float4 _e286 = unnamed.u_layerB.inner[_e283];
    r_1 = _e286;
    float _e287 = t_3;
    float _e290 = r_1[2u];
    t_3 = metal::pow(metal::max(_e287, 0.0), _e290);
    float _e293 = r_1[3u];
    if (_e293 >= 2.0) {
        float _e295 = t_3;
        float _e297 = r_1[3u];
        float _e301 = r_1[3u];
        float _e305 = r_1[3u];
        t_3 = metal::min(metal::floor(_e295 * _e297), _e301 - 1.0) / (_e305 - 1.0);
    }
    deep = metal::float3(0.011764706, 0.015686275, 0.36862746);
    mid = metal::float3(0.0, 0.46666667, 0.7137255);
    shallow = metal::float3(0.5647059, 0.8784314, 0.9372549);
    float _e308 = t_3;
    if (_e308 < 0.5) {
        metal::float3 _e310 = deep;
        metal::float3 _e311 = mid;
        float _e312 = t_3;
        local_4 = metal::mix(_e310, _e311, metal::float3(_e312 * 2.0));
    } else {
        metal::float3 _e316 = mid;
        metal::float3 _e317 = shallow;
        float _e318 = t_3;
        local_4 = metal::mix(_e316, _e317, metal::float3((_e318 - 0.5) * 2.0));
    }
    metal::float3 _e323 = local_4;
    int _e324 = layer_4;
    param_43 = _e324;
    float _e325 = t_3;
    param_44 = _e325;
    metal::float4 _e326 = cspRampAt_u0028_i1_u003b_f1_u003b(param_43, param_44, unnamed);
    return metal::float4(_e323.x, _e323.y, _e323.z, _e326.w);
}

uint cspWaterClass_u0028_vf2_u003b(
    thread metal::float2& merc,
    metal::texture2d<uint, metal::access::sample> u_waterMask
) {
    float latitude = {};
    metal::int2 q = {};
    metal::uint4 packed = {};
    float _e265 = merc[1u];
    latitude = ((metal::atan(metal::sinh(3.1415927 * (1.0 - (2.0 * _e265))))) * 57.295779513082322865);
    float _e273 = merc[0u];
    float _e279 = latitude;
    q = metal::int2(naga_f2i32(metal::min(16383.0, metal::floor(metal::fract(_e273) * 16384.0))), naga_f2i32(metal::clamp(metal::floor(((90.0 - _e279) / 180.0) * 8192.0), 0.0, 8191.0)));
    int _e288 = q[0u];
    int _e291 = q[1u];
    metal::uint4 _e294 = u_waterMask.read(metal::uint2(metal::int2(naga_div(_e288, 8), naga_div(_e291, 4))), 0);
    packed = _e294;
    int _e296 = q[1u];
    uint _e305 = packed[as_type<int>(as_type<uint>(_e296) - as_type<uint>(as_type<int>(as_type<uint>(naga_f2i32(metal::floor(static_cast<float>(_e296) / static_cast<float>(4)))) * as_type<uint>(4))))];
    int _e307 = q[0u];
    return (_e305 >> as_type<uint>(as_type<uint>(as_type<int>(as_type<uint>(14) - as_type<uint>(as_type<int>(as_type<uint>(2) * as_type<uint>(as_type<int>(as_type<uint>(_e307) - as_type<uint>(as_type<int>(as_type<uint>(naga_f2i32(metal::floor(static_cast<float>(_e307) / static_cast<float>(8)))) * as_type<uint>(8))))))))))) & 3u;
}

metal::float2 cspCustom32_u0028_struct_u002d_CspCtx_u002d_vi2_u002d_f1_u002d_f1_u002d_f1_u002d_f1_u002d_f1_u002d_f1_u002d_f1_u002d_f1_u002d_f11_u003b(
    thread CspCtx& c_4
) {
    float _e262 = c_4.height;
    float _e269 = c_4.height;
    float _e271 = c_4.height;
    return metal::float2((_e262 - (metal::floor(_e262 / 17.0) * 17.0)) / 17.0, (_e269 == _e271) ? 1.0 : 0.0);
}

metal::float2 cspCustomStyle_u0028_i1_u003b_struct_u002d_CspCtx_u002d_vi2_u002d_f1_u002d_f1_u002d_f1_u002d_f1_u002d_f1_u002d_f1_u002d_f1_u002d_f1_u002d_f11_u003b(
    thread int& style,
    thread CspCtx& c_5
) {
    CspCtx param_45 = {};
    int _e263 = style;
    if (_e263 == 32) {
        CspCtx _e265 = c_5;
        param_45 = _e265;
        metal::float2 _e266 = cspCustom32_u0028_struct_u002d_CspCtx_u002d_vi2_u002d_f1_u002d_f1_u002d_f1_u002d_f1_u002d_f1_u002d_f1_u002d_f1_u002d_f1_u002d_f11_u003b(param_45);
        CspCtx _e267 = param_45;
        c_5 = _e267;
        return _e266;
    }
    return metal::float2(0.0, 0.0);
}

float cspMultiShade_u0028_f1_u003b_f1_u003b(
    thread float& dx_2,
    thread float& dy_2,
    constant CskUniforms& unnamed
) {
    float aspect = {};
    float param_46 = {};
    float param_47 = {};
    float sum = {};
    float total = {};
    int index = {};
    float az_1 = {};
    float s_5 = {};
    float weight = {};
    float local_5 = {};
    float param_48 = {};
    float param_49 = {};
    float param_50 = {};
    float _e275 = dx_2;
    param_46 = _e275;
    float _e276 = dy_2;
    param_47 = _e276;
    float _e277 = cspAspectOf_u0028_f1_u003b_f1_u003b(param_46, param_47);
    aspect = _e277;
    sum = 0.0;
    total = 0.0;
    index = 0;
    uint2 loop_bound_1 = uint2(4294967295u);
    bool loop_init_1 = true;
    while(true) {
        if (metal::all(loop_bound_1 == uint2(0u))) { break; }
        loop_bound_1 -= uint2(loop_bound_1.y == 0u, 1u);
        if (!loop_init_1) {
            int _e316 = index;
            index = as_type<int>(as_type<uint>(_e316) + as_type<uint>(1));
        }
        loop_init_1 = false;
        int _e278 = index;
        if (_e278 < 4) {
            float _e281 = unnamed.u_sunAzimuth;
            int _e283 = index;
            az_1 = (_e281 - 90.0) + (45.0 * static_cast<float>(_e283));
            float _e287 = aspect;
            float _e288 = az_1;
            s_5 = metal::sin((((_e287 - (_e288 - (metal::floor(_e288 / 360.0) * 360.0)))) * 0.017453292519943295474));
            float _e296 = dx_2;
            float _e297 = dy_2;
            if (metal::length(metal::float2(_e296, _e297)) < 0.000000000001) {
                local_5 = 1.0;
            } else {
                float _e301 = s_5;
                float _e302 = s_5;
                local_5 = _e301 * _e302;
            }
            float _e304 = local_5;
            weight = _e304;
            float _e305 = weight;
            float _e306 = dx_2;
            param_48 = _e306;
            float _e307 = dy_2;
            param_49 = _e307;
            float _e308 = az_1;
            param_50 = _e308;
            float _e309 = cspDirectShade_u0028_f1_u003b_f1_u003b_f1_u003b(param_48, param_49, param_50, unnamed);
            float _e311 = sum;
            sum = _e311 + (_e305 * _e309);
            float _e313 = weight;
            float _e314 = total;
            total = _e314 + _e313;
            continue;
        } else {
            break;
        }
    }
    float _e319 = unnamed.u_ambient;
    float _e321 = unnamed.u_ambient;
    float _e323 = sum;
    float _e325 = total;
    return _e319 + (((1.0 - _e321) * _e323) / metal::max(_e325, 0.00001));
}

float cspShadeAt_u0028_f1_u003b_f1_u003b_f1_u003b(
    thread float& dx_3,
    thread float& dy_3,
    thread float& azimuth_1,
    constant CskUniforms& unnamed
) {
    float param_51 = {};
    float param_52 = {};
    float param_53 = {};
    float _e267 = unnamed.u_ambient;
    float _e269 = unnamed.u_ambient;
    float _e271 = dx_3;
    param_51 = _e271;
    float _e272 = dy_3;
    param_52 = _e272;
    float _e273 = azimuth_1;
    param_53 = _e273;
    float _e274 = cspDirectShade_u0028_f1_u003b_f1_u003b_f1_u003b(param_51, param_52, param_53, unnamed);
    return _e267 + ((1.0 - _e269) * _e274);
}

metal::float2 cspLayerValue_u0028_i1_u003b_f1_u003b_struct_u002d_CspCtx_u002d_vi2_u002d_f1_u002d_f1_u002d_f1_u002d_f1_u002d_f1_u002d_f1_u002d_f1_u002d_f1_u002d_f11_u003b(
    thread int& style_1,
    thread float& param_54,
    thread CspCtx& c_6,
    constant CskUniforms& unnamed
) {
    float param_55 = {};
    float param_56 = {};
    float param_57 = {};
    float param_58 = {};
    float param_59 = {};
    metal::float2 local_6 = {};
    metal::float2 local_7 = {};
    float interval = {};
    float local_8 = {};
    float local_9 = {};
    float local_10 = {};
    float local_11 = {};
    float perPixel = {};
    float spacing = {};
    float multiple = {};
    float distanceToLine = {};
    float lineWidth = {};
    bool indexLine = {};
    int param_60 = {};
    CspCtx param_61 = {};
    int _e283 = style_1;
    if (_e283 == 0) {
        float _e286 = c_6.sdx;
        param_55 = _e286;
        float _e288 = c_6.sdy;
        param_56 = _e288;
        float _e290 = unnamed.u_sunAzimuth;
        param_57 = _e290;
        float _e291 = cspShadeAt_u0028_f1_u003b_f1_u003b_f1_u003b(param_55, param_56, param_57, unnamed);
        return metal::float2(_e291, 1.0);
    }
    int _e293 = style_1;
    if (_e293 == 1) {
        float _e296 = c_6.sdx;
        param_58 = _e296;
        float _e298 = c_6.sdy;
        param_59 = _e298;
        float _e299 = cspMultiShade_u0028_f1_u003b_f1_u003b(param_58, param_59, unnamed);
        return metal::float2(_e299, 1.0);
    }
    int _e301 = style_1;
    if (_e301 == 2) {
        float _e304 = c_6.slope;
        return metal::float2(_e304, 1.0);
    }
    int _e306 = style_1;
    if (_e306 == 3) {
        float _e309 = c_6.aspect;
        if (_e309 < 0.0) {
            local_6 = metal::float2(0.0, 0.0);
        } else {
            float _e312 = c_6.aspect;
            local_6 = metal::float2(_e312, 1.0);
        }
        metal::float2 _e314 = local_6;
        return _e314;
    }
    int _e315 = style_1;
    if (_e315 == 4) {
        float _e318 = c_6.aspect;
        if (_e318 < 0.0) {
            local_7 = metal::float2(0.0, 0.0);
        } else {
            float _e321 = c_6.aspect;
            local_7 = metal::float2(metal::cos(((_e321) * 0.017453292519943295474)), 1.0);
        }
        metal::float2 _e325 = local_7;
        return _e325;
    }
    int _e326 = style_1;
    if (_e326 == 5) {
        float _e329 = c_6.height;
        return metal::float2(_e329, 1.0);
    }
    int _e331 = style_1;
    if (_e331 == 10) {
        float _e334 = c_6.height;
        float _e336 = c_6.base;
        return metal::float2(metal::max(0.0, _e334 - _e336), 1.0);
    }
    int _e340 = style_1;
    int _e342 = style_1;
    int _e345 = style_1;
    if (((_e340 >= 6) && (_e342 <= 9)) || (_e345 == 11)) {
        int _e348 = style_1;
        if (_e348 == 6) {
            local_8 = 2.0;
        } else {
            int _e350 = style_1;
            if (_e350 == 7) {
                local_9 = 5.0;
            } else {
                int _e352 = style_1;
                if (_e352 == 8) {
                    local_10 = 10.0;
                } else {
                    int _e354 = style_1;
                    if (_e354 == 9) {
                        local_11 = 25.0;
                    } else {
                        float _e356 = param_54;
                        local_11 = metal::max(0.5, _e356);
                    }
                    float _e358 = local_11;
                    local_10 = _e358;
                }
                float _e359 = local_10;
                local_9 = _e359;
            }
            float _e360 = local_9;
            local_8 = _e360;
        }
        float _e361 = local_8;
        interval = _e361;
        float _e363 = c_6.dx;
        float _e365 = c_6.dy;
        float _e369 = c_6.res;
        perPixel = (metal::length(metal::float2(_e363, _e365)) * _e369) * 3.28084;
        float _e372 = perPixel;
        if (_e372 > 0.0) {
            float _e374 = interval;
            float _e375 = perPixel;
            spacing = _e374 / _e375;
            float _e377 = spacing;
            if (_e377 < 3.0) {
                float _e379 = spacing;
                if ((_e379 * 5.0) >= 3.0) {
                    float _e382 = interval;
                    interval = _e382 * 5.0;
                } else {
                    return metal::float2(0.0, 0.0);
                }
            }
        }
        float _e385 = c_6.height;
        float _e387 = interval;
        multiple = (_e385 * 3.28084) / _e387;
        float _e389 = multiple;
        float _e390 = multiple;
        float _e394 = interval;
        distanceToLine = metal::abs(_e389 - metal::rint(_e390)) * _e394;
        float _e396 = interval;
        float _e398 = perPixel;
        lineWidth = metal::max(0.35, metal::min(_e396 * 0.5, _e398 * 0.7));
        float _e402 = distanceToLine;
        float _e403 = lineWidth;
        if (_e402 >= _e403) {
            return metal::float2(0.0, 0.0);
        }
        float _e405 = multiple;
        float _e406 = metal::rint(_e405);
        indexLine = metal::abs(_e406 - (metal::floor(_e406 / 5.0) * 5.0)) < 0.5;
        bool _e413 = indexLine;
        return metal::float2(_e413 ? 1.0 : 0.0, 1.0);
    }
    int _e416 = style_1;
    if (_e416 >= 32) {
        int _e418 = style_1;
        param_60 = _e418;
        CspCtx _e419 = c_6;
        param_61 = _e419;
        metal::float2 _e420 = cspCustomStyle_u0028_i1_u003b_struct_u002d_CspCtx_u002d_vi2_u002d_f1_u002d_f1_u002d_f1_u002d_f1_u002d_f1_u002d_f1_u002d_f1_u002d_f1_u002d_f11_u003b(param_60, param_61);
        CspCtx _e421 = param_61;
        c_6 = _e421;
        return _e420;
    }
    return metal::float2(0.0, 0.0);
}

bool csk_isinf_u0028_f1_u003b(
    thread float& v_1
) {
    float _e261 = v_1;
    return (as_type<uint>(_e261) & 2147483647u) == 2139095040u;
}

bool csk_isnan_u0028_f1_u003b(
    thread float& v_2
) {
    float _e261 = v_2;
    return (as_type<uint>(_e261) & 2147483647u) > 2139095040u;
}

bool csk_aux_u0028_t21_u003b_vi2_u003b_f1_u003b(
    metal::texture2d<float, metal::access::sample> image,
    thread metal::int2& p,
    thread float& v_3
) {
    metal::float2 a_1 = {};
    float param_62 = {};
    float param_63 = {};
    bool phi_316_ = {};
    bool phi_323_ = {};
    metal::int2 _e266 = p;
    metal::float4 _e272 = image.read(metal::uint2(metal::clamp(_e266, metal::int2(0, 0), as_type<metal::int2>(as_type<metal::uint2>(static_cast<metal::int2>(metal::uint2(image.get_width(0), image.get_height(0)))) - as_type<metal::uint2>(metal::int2(1))))), 0);
    a_1 = _e272.xy;
    float _e275 = a_1[0u];
    v_3 = _e275;
    float _e277 = a_1[1u];
    bool _e278 = _e277 > 0.0;
    phi_316_ = _e278;
    if (_e278) {
        float _e279 = v_3;
        param_62 = _e279;
        bool _e280 = csk_isnan_u0028_f1_u003b(param_62);
        phi_316_ = !(_e280);
    }
    bool _e283 = phi_316_;
    phi_323_ = _e283;
    if (_e283) {
        float _e284 = v_3;
        param_63 = _e284;
        bool _e285 = csk_isinf_u0028_f1_u003b(param_63);
        phi_323_ = !(_e285);
    }
    bool _e288 = phi_323_;
    return _e288;
}

bool csp_landBase_u0028_vi2_u003b_f1_u003b(
    thread metal::int2& p_1,
    thread float& v_4,
    metal::texture2d<float, metal::access::sample> csk_land
) {
    metal::int2 param_64 = {};
    float param_65 = {};
    metal::int2 _e264 = p_1;
    param_64 = _e264;
    bool _e265 = csk_aux_u0028_t21_u003b_vi2_u003b_f1_u003b(csk_land, param_64, param_65);
    float _e266 = param_65;
    v_4 = _e266;
    return _e265;
}

bool csp_base_u0028_vi2_u003b_f1_u003b(
    thread metal::int2& p_2,
    thread float& v_5,
    metal::texture2d<float, metal::access::sample> csk_base
) {
    metal::int2 param_66 = {};
    float param_67 = {};
    metal::int2 _e264 = p_2;
    param_66 = _e264;
    bool _e265 = csk_aux_u0028_t21_u003b_vi2_u003b_f1_u003b(csk_base, param_66, param_67);
    float _e266 = param_67;
    v_5 = _e266;
    return _e265;
}

bool csp_blur_u0028_vi2_u003b_f1_u003b(
    thread metal::int2& p_3,
    thread float& v_6,
    metal::texture2d<float, metal::access::sample> csk_blur
) {
    metal::int2 param_68 = {};
    float param_69 = {};
    metal::int2 _e264 = p_3;
    param_68 = _e264;
    bool _e265 = csk_aux_u0028_t21_u003b_vi2_u003b_f1_u003b(csk_blur, param_68, param_69);
    float _e266 = param_69;
    v_6 = _e266;
    return _e265;
}

metal::int2 csp_size_u0028_(
    metal::texture2d<float, metal::access::sample> csk_heights
) {
    return static_cast<metal::int2>(metal::uint2(csk_heights.get_width(0), csk_heights.get_height(0)));
}

metal::int2 csk_clamp_u0028_vi2_u003b(
    thread metal::int2& p_4,
    metal::texture2d<float, metal::access::sample> csk_heights
) {
    metal::int2 _e261 = p_4;
    metal::int2 _e262 = csp_size_u0028_(csk_heights);
    return metal::clamp(_e261, metal::int2(0, 0), as_type<metal::int2>(as_type<metal::uint2>(_e262) - as_type<metal::uint2>(metal::int2(1))));
}

float csp_height_u0028_vi2_u003b(
    thread metal::int2& p_5,
    metal::texture2d<float, metal::access::sample> csk_heights
) {
    metal::int2 param_70 = {};
    metal::int2 _e262 = p_5;
    param_70 = _e262;
    metal::int2 _e263 = csk_clamp_u0028_vi2_u003b(param_70, csk_heights);
    metal::float4 _e264 = csk_heights.read(metal::uint2(_e263), 0);
    return _e264.x;
}

float cspH_u0028_vi2_u003b(
    thread metal::int2& q_1,
    metal::texture2d<float, metal::access::sample> csk_heights,
    metal::texture2d<float, metal::access::sample> csk_blur,
    constant CskUniforms& unnamed
) {
    float h = {};
    metal::int2 param_71 = {};
    float b_5 = {};
    metal::int2 param_72 = {};
    float param_73 = {};
    bool phi_1207_ = {};
    metal::int2 _e266 = q_1;
    param_71 = _e266;
    float _e267 = csp_height_u0028_vi2_u003b(param_71, csk_heights);
    h = _e267;
    float _e269 = unnamed.u_detail;
    bool _e270 = _e269 != 0.0;
    phi_1207_ = _e270;
    if (_e270) {
        metal::int2 _e271 = q_1;
        param_72 = _e271;
        bool _e272 = csp_blur_u0028_vi2_u003b_f1_u003b(param_72, param_73, csk_blur);
        float _e273 = param_73;
        b_5 = _e273;
        phi_1207_ = _e272;
    }
    bool _e275 = phi_1207_;
    if (_e275) {
        float _e277 = unnamed.u_detail;
        float _e278 = h;
        float _e279 = b_5;
        float _e282 = h;
        h = _e282 + (_e277 * (_e278 - _e279));
    }
    float _e284 = h;
    return _e284;
}

int csp_rank_u0028_vi2_u003b(
    thread metal::int2& p_6,
    metal::texture2d<float, metal::access::sample> csk_heights,
    metal::texture2d<uint, metal::access::sample> csk_ranks
) {
    metal::int2 param_74 = {};
    metal::int2 _e262 = p_6;
    param_74 = _e262;
    metal::int2 _e263 = csk_clamp_u0028_vi2_u003b(param_74, csk_heights);
    metal::uint4 _e264 = csk_ranks.read(metal::uint2(_e263), 0);
    return as_type<int>(_e264.x);
}

bool csp_valid_u0028_vi2_u003b(
    thread metal::int2& p_7,
    metal::texture2d<float, metal::access::sample> csk_heights,
    metal::texture2d<uint, metal::access::sample> csk_ranks
) {
    float h_1 = {};
    metal::int2 param_75 = {};
    metal::int2 param_76 = {};
    float param_77 = {};
    float param_78 = {};
    bool phi_279_ = {};
    bool phi_286_ = {};
    metal::int2 _e266 = p_7;
    param_75 = _e266;
    float _e267 = csp_height_u0028_vi2_u003b(param_75, csk_heights);
    h_1 = _e267;
    metal::int2 _e268 = p_7;
    param_76 = _e268;
    int _e269 = csp_rank_u0028_vi2_u003b(param_76, csk_heights, csk_ranks);
    bool _e270 = _e269 > 0;
    phi_279_ = _e270;
    if (_e270) {
        float _e271 = h_1;
        param_77 = _e271;
        bool _e272 = csk_isnan_u0028_f1_u003b(param_77);
        phi_279_ = !(_e272);
    }
    bool _e275 = phi_279_;
    phi_286_ = _e275;
    if (_e275) {
        float _e276 = h_1;
        param_78 = _e276;
        bool _e277 = csk_isinf_u0028_f1_u003b(param_78);
        phi_286_ = !(_e277);
    }
    bool _e280 = phi_286_;
    float _e281 = h_1;
    return _e280 && (_e281 > -100000000000000000000.0);
}

metal::float4 cspStack_u0028_vi2_u003b_f1_u003b_f1_u003b_f1_u003b_f1_u003b_vf2_u003b(
    thread metal::int2& p_8,
    thread float& value_5,
    thread float& groundRes,
    thread float& cosB,
    thread float& sinB,
    thread metal::float2& merc_1,
    metal::texture2d<float, metal::access::sample> csk_heights,
    metal::texture2d<uint, metal::access::sample> csk_ranks,
    metal::texture2d<float, metal::access::sample> csk_blur,
    metal::texture2d<float, metal::access::sample> csk_base,
    metal::texture2d<float, metal::access::sample> csk_land,
    constant CskUniforms& unnamed,
    metal::texture2d<uint, metal::access::sample> u_waterMask
) {
    metal::int2 px = {};
    metal::int2 py = {};
    metal::int2 param_79 = {};
    metal::int2 param_80 = {};
    metal::int2 param_81 = {};
    metal::int2 param_82 = {};
    metal::int2 param_83 = {};
    metal::int2 param_84 = {};
    metal::int2 param_85 = {};
    metal::int2 param_86 = {};
    CspCtx c_7 = {};
    float a_2 = {};
    metal::int2 param_87 = {};
    float b_6 = {};
    metal::int2 param_88 = {};
    float cc = {};
    metal::int2 param_89 = {};
    float d_1 = {};
    metal::int2 param_90 = {};
    float f = {};
    metal::int2 param_91 = {};
    float g = {};
    metal::int2 param_92 = {};
    float q_2 = {};
    metal::int2 param_93 = {};
    float k_2 = {};
    metal::int2 param_94 = {};
    float dxS = {};
    float dyS = {};
    float zFactor = {};
    float local_12 = {};
    float param_95 = {};
    float param_96 = {};
    float legacyBase = {};
    float baseValue = {};
    metal::int2 param_97 = {};
    float param_98 = {};
    float local_13 = {};
    float landBase = {};
    float landBaseValue = {};
    metal::int2 param_99 = {};
    float param_100 = {};
    float local_14 = {};
    metal::float4 acc = {};
    int i = {};
    metal::float4 layer_5 = {};
    int style_2 = {};
    float param_101 = {};
    int flags = {};
    metal::float2 v_7 = {};
    int param_102 = {};
    float param_103 = {};
    CspCtx param_104 = {};
    uint waterClass = {};
    uint local_15 = {};
    metal::float2 param_105 = {};
    metal::float4 colour = {};
    metal::float4 local_16 = {};
    int param_106 = {};
    float param_107 = {};
    metal::float2 param_108 = {};
    metal::float4 local_17 = {};
    int param_109 = {};
    float param_110 = {};
    metal::float2 param_111 = {};
    int param_112 = {};
    float param_113 = {};
    float shade = {};
    float param_114 = {};
    float param_115 = {};
    float param_116 = {};
    float alpha = {};
    metal::float4 param_117 = {};
    metal::float3 param_118 = {};
    float param_119 = {};
    int param_120 = {};
    metal::float3 straight_1 = {};
    metal::float3 param_121 = {};
    bool phi_2239_ = {};
    bool phi_2249_ = {};
    bool phi_2257_ = {};
    bool phi_2265_ = {};
    bool phi_2275_ = {};
    bool phi_2283_ = {};
    bool phi_2293_ = {};
    bool phi_2584_ = {};
    bool phi_2601_ = {};
    bool phi_2624_ = {};
    px = metal::int2(1, 0);
    py = metal::int2(0, 1);
    metal::int2 _e344 = p_8;
    metal::int2 _e345 = px;
    metal::int2 _e347 = py;
    param_79 = as_type<metal::int2>(as_type<metal::uint2>(as_type<metal::int2>(as_type<metal::uint2>(_e344) - as_type<metal::uint2>(_e345))) - as_type<metal::uint2>(_e347));
    bool _e349 = csp_valid_u0028_vi2_u003b(param_79, csk_heights, csk_ranks);
    phi_2239_ = _e349;
    if (_e349) {
        metal::int2 _e350 = p_8;
        metal::int2 _e351 = py;
        param_80 = as_type<metal::int2>(as_type<metal::uint2>(_e350) - as_type<metal::uint2>(_e351));
        bool _e353 = csp_valid_u0028_vi2_u003b(param_80, csk_heights, csk_ranks);
        phi_2239_ = _e353;
    }
    bool _e355 = phi_2239_;
    phi_2249_ = _e355;
    if (_e355) {
        metal::int2 _e356 = p_8;
        metal::int2 _e357 = px;
        metal::int2 _e359 = py;
        param_81 = as_type<metal::int2>(as_type<metal::uint2>(as_type<metal::int2>(as_type<metal::uint2>(_e356) + as_type<metal::uint2>(_e357))) - as_type<metal::uint2>(_e359));
        bool _e361 = csp_valid_u0028_vi2_u003b(param_81, csk_heights, csk_ranks);
        phi_2249_ = _e361;
    }
    bool _e363 = phi_2249_;
    phi_2257_ = _e363;
    if (_e363) {
        metal::int2 _e364 = p_8;
        metal::int2 _e365 = px;
        param_82 = as_type<metal::int2>(as_type<metal::uint2>(_e364) - as_type<metal::uint2>(_e365));
        bool _e367 = csp_valid_u0028_vi2_u003b(param_82, csk_heights, csk_ranks);
        phi_2257_ = _e367;
    }
    bool _e369 = phi_2257_;
    phi_2265_ = _e369;
    if (_e369) {
        metal::int2 _e370 = p_8;
        metal::int2 _e371 = px;
        param_83 = as_type<metal::int2>(as_type<metal::uint2>(_e370) + as_type<metal::uint2>(_e371));
        bool _e373 = csp_valid_u0028_vi2_u003b(param_83, csk_heights, csk_ranks);
        phi_2265_ = _e373;
    }
    bool _e375 = phi_2265_;
    phi_2275_ = _e375;
    if (_e375) {
        metal::int2 _e376 = p_8;
        metal::int2 _e377 = px;
        metal::int2 _e379 = py;
        param_84 = as_type<metal::int2>(as_type<metal::uint2>(as_type<metal::int2>(as_type<metal::uint2>(_e376) - as_type<metal::uint2>(_e377))) + as_type<metal::uint2>(_e379));
        bool _e381 = csp_valid_u0028_vi2_u003b(param_84, csk_heights, csk_ranks);
        phi_2275_ = _e381;
    }
    bool _e383 = phi_2275_;
    phi_2283_ = _e383;
    if (_e383) {
        metal::int2 _e384 = p_8;
        metal::int2 _e385 = py;
        param_85 = as_type<metal::int2>(as_type<metal::uint2>(_e384) + as_type<metal::uint2>(_e385));
        bool _e387 = csp_valid_u0028_vi2_u003b(param_85, csk_heights, csk_ranks);
        phi_2283_ = _e387;
    }
    bool _e389 = phi_2283_;
    phi_2293_ = _e389;
    if (_e389) {
        metal::int2 _e390 = p_8;
        metal::int2 _e391 = px;
        metal::int2 _e393 = py;
        param_86 = as_type<metal::int2>(as_type<metal::uint2>(as_type<metal::int2>(as_type<metal::uint2>(_e390) + as_type<metal::uint2>(_e391))) + as_type<metal::uint2>(_e393));
        bool _e395 = csp_valid_u0028_vi2_u003b(param_86, csk_heights, csk_ranks);
        phi_2293_ = _e395;
    }
    bool _e397 = phi_2293_;
    if (!(_e397)) {
        return metal::float4(0.0, 0.0, 0.0, 0.0);
    }
    metal::int2 _e399 = p_8;
    c_7.p = _e399;
    float _e401 = value_5;
    c_7.height = _e401;
    float _e403 = groundRes;
    c_7.res = _e403;
    c_7.dx = 0.0;
    c_7.dy = 0.0;
    c_7.sdx = 0.0;
    c_7.sdy = 0.0;
    c_7.slope = 0.0;
    c_7.aspect = -1.0;
    float _e412 = unnamed.u_stackGradient;
    if (_e412 > 0.5) {
        metal::int2 _e414 = p_8;
        metal::int2 _e415 = px;
        metal::int2 _e417 = py;
        param_87 = as_type<metal::int2>(as_type<metal::uint2>(as_type<metal::int2>(as_type<metal::uint2>(_e414) - as_type<metal::uint2>(_e415))) - as_type<metal::uint2>(_e417));
        float _e419 = cspH_u0028_vi2_u003b(param_87, csk_heights, csk_blur, unnamed);
        a_2 = _e419;
        metal::int2 _e420 = p_8;
        metal::int2 _e421 = py;
        param_88 = as_type<metal::int2>(as_type<metal::uint2>(_e420) - as_type<metal::uint2>(_e421));
        float _e423 = cspH_u0028_vi2_u003b(param_88, csk_heights, csk_blur, unnamed);
        b_6 = _e423;
        metal::int2 _e424 = p_8;
        metal::int2 _e425 = px;
        metal::int2 _e427 = py;
        param_89 = as_type<metal::int2>(as_type<metal::uint2>(as_type<metal::int2>(as_type<metal::uint2>(_e424) + as_type<metal::uint2>(_e425))) - as_type<metal::uint2>(_e427));
        float _e429 = cspH_u0028_vi2_u003b(param_89, csk_heights, csk_blur, unnamed);
        cc = _e429;
        metal::int2 _e430 = p_8;
        metal::int2 _e431 = px;
        param_90 = as_type<metal::int2>(as_type<metal::uint2>(_e430) - as_type<metal::uint2>(_e431));
        float _e433 = cspH_u0028_vi2_u003b(param_90, csk_heights, csk_blur, unnamed);
        d_1 = _e433;
        metal::int2 _e434 = p_8;
        metal::int2 _e435 = px;
        param_91 = as_type<metal::int2>(as_type<metal::uint2>(_e434) + as_type<metal::uint2>(_e435));
        float _e437 = cspH_u0028_vi2_u003b(param_91, csk_heights, csk_blur, unnamed);
        f = _e437;
        metal::int2 _e438 = p_8;
        metal::int2 _e439 = px;
        metal::int2 _e441 = py;
        param_92 = as_type<metal::int2>(as_type<metal::uint2>(as_type<metal::int2>(as_type<metal::uint2>(_e438) - as_type<metal::uint2>(_e439))) + as_type<metal::uint2>(_e441));
        float _e443 = cspH_u0028_vi2_u003b(param_92, csk_heights, csk_blur, unnamed);
        g = _e443;
        metal::int2 _e444 = p_8;
        metal::int2 _e445 = py;
        param_93 = as_type<metal::int2>(as_type<metal::uint2>(_e444) + as_type<metal::uint2>(_e445));
        float _e447 = cspH_u0028_vi2_u003b(param_93, csk_heights, csk_blur, unnamed);
        q_2 = _e447;
        metal::int2 _e448 = p_8;
        metal::int2 _e449 = px;
        metal::int2 _e451 = py;
        param_94 = as_type<metal::int2>(as_type<metal::uint2>(as_type<metal::int2>(as_type<metal::uint2>(_e448) + as_type<metal::uint2>(_e449))) + as_type<metal::uint2>(_e451));
        float _e453 = cspH_u0028_vi2_u003b(param_94, csk_heights, csk_blur, unnamed);
        k_2 = _e453;
        float _e454 = cc;
        float _e455 = f;
        float _e458 = k_2;
        float _e460 = a_2;
        float _e461 = d_1;
        float _e464 = g;
        float _e467 = groundRes;
        dxS = (((_e454 + (2.0 * _e455)) + _e458) - ((_e460 + (2.0 * _e461)) + _e464)) / (8.0 * _e467);
        float _e470 = g;
        float _e471 = q_2;
        float _e474 = k_2;
        float _e476 = a_2;
        float _e477 = b_6;
        float _e480 = cc;
        float _e483 = groundRes;
        dyS = (((_e470 + (2.0 * _e471)) + _e474) - ((_e476 + (2.0 * _e477)) + _e480)) / (8.0 * _e483);
        float _e486 = dxS;
        float _e487 = cosB;
        float _e489 = dyS;
        float _e490 = sinB;
        c_7.dx = (_e486 * _e487) + (_e489 * _e490);
        float _e494 = dxS;
        float _e495 = sinB;
        float _e497 = dyS;
        float _e498 = cosB;
        c_7.dy = -(((_e494 * _e495) - (_e497 * _e498)));
        float _e503 = groundRes;
        zFactor = 1.0 + (0.024 * metal::pow(metal::max(_e503, 0.0), 0.664));
        float _e509 = c_7.dx;
        float _e510 = zFactor;
        float _e513 = unnamed.u_reliefExag;
        c_7.sdx = (_e509 * _e510) * _e513;
        float _e517 = c_7.dy;
        float _e518 = zFactor;
        float _e521 = unnamed.u_reliefExag;
        c_7.sdy = (_e517 * _e518) * _e521;
        float _e525 = c_7.dx;
        float _e527 = c_7.dy;
        c_7.slope = ((metal::atan(metal::length(metal::float2(_e525, _e527)))) * 57.295779513082322865);
        float _e534 = c_7.dx;
        float _e536 = c_7.dy;
        if (metal::length(metal::float2(_e534, _e536)) <= 0.008726868) {
            local_12 = -1.0;
        } else {
            float _e541 = c_7.dx;
            param_95 = _e541;
            float _e543 = c_7.dy;
            param_96 = _e543;
            float _e544 = cspAspectOf_u0028_f1_u003b_f1_u003b(param_95, param_96);
            local_12 = _e544;
        }
        float _e545 = local_12;
        c_7.aspect = _e545;
    }
    metal::int2 _e547 = p_8;
    param_97 = _e547;
    bool _e548 = csp_base_u0028_vi2_u003b_f1_u003b(param_97, param_98, csk_base);
    float _e549 = param_98;
    baseValue = _e549;
    if (_e548) {
        float _e550 = baseValue;
        local_13 = _e550;
    } else {
        float _e552 = unnamed.u_remFlatBase;
        local_13 = _e552;
    }
    float _e553 = local_13;
    legacyBase = _e553;
    metal::int2 _e554 = p_8;
    param_99 = _e554;
    bool _e555 = csp_landBase_u0028_vi2_u003b_f1_u003b(param_99, param_100, csk_land);
    float _e556 = param_100;
    landBaseValue = _e556;
    if (_e555) {
        float _e557 = landBaseValue;
        local_14 = _e557;
    } else {
        float _e559 = unnamed.u_remLandBase;
        local_14 = _e559;
    }
    float _e560 = local_14;
    landBase = _e560;
    acc = metal::float4(0.0, 0.0, 0.0, 0.0);
    i = 0;
    uint2 loop_bound_2 = uint2(4294967295u);
    bool loop_init_2 = true;
    while(true) {
        if (metal::all(loop_bound_2 == uint2(0u))) { break; }
        loop_bound_2 -= uint2(loop_bound_2.y == 0u, 1u);
        if (!loop_init_2) {
            int _e712 = i;
            i = as_type<int>(as_type<uint>(_e712) + as_type<uint>(1));
        }
        loop_init_2 = false;
        int _e561 = i;
        if (_e561 < 4) {
            int _e563 = i;
            float _e566 = unnamed.u_layerCount;
            if (static_cast<float>(_e563) >= _e566) {
                break;
            }
            int _e568 = i;
            metal::float4 _e571 = unnamed.u_layerA.inner[_e568];
            layer_5 = _e571;
            float _e573 = layer_5[0u];
            style_2 = naga_f2i32(_e573 + 0.5);
            int _e576 = i;
            float _e580 = unnamed.u_layerC.inner[_e576][0u];
            param_101 = _e580;
            int _e581 = i;
            float _e585 = unnamed.u_layerC.inner[_e581][1u];
            flags = naga_f2i32(_e585 + 0.5);
            int _e588 = flags;
            float _e591 = landBase;
            float _e592 = legacyBase;
            c_7.base = ((_e588 & 2) != 0) ? _e591 : _e592;
            int _e595 = style_2;
            param_102 = _e595;
            float _e596 = param_101;
            param_103 = _e596;
            CspCtx _e597 = c_7;
            param_104 = _e597;
            metal::float2 _e598 = cspLayerValue_u0028_i1_u003b_f1_u003b_struct_u002d_CspCtx_u002d_vi2_u002d_f1_u002d_f1_u002d_f1_u002d_f1_u002d_f1_u002d_f1_u002d_f1_u002d_f1_u002d_f11_u003b(param_102, param_103, param_104, unnamed);
            CspCtx _e599 = param_104;
            c_7 = _e599;
            v_7 = _e598;
            float _e601 = v_7[1u];
            if (_e601 <= 0.0) {
                continue;
            }
            int _e603 = style_2;
            int _e605 = style_2;
            bool _e607 = (_e603 == 5) || (_e605 == 10);
            phi_2584_ = _e607;
            if (_e607) {
                int _e608 = flags;
                phi_2584_ = (_e608 & 5) != 0;
            }
            bool _e612 = phi_2584_;
            if (_e612) {
                metal::float2 _e613 = merc_1;
                param_105 = _e613;
                uint _e614 = cspWaterClass_u0028_vf2_u003b(param_105, u_waterMask);
                local_15 = _e614;
            } else {
                local_15 = 0u;
            }
            uint _e615 = local_15;
            waterClass = _e615;
            uint _e616 = waterClass;
            bool _e617 = _e616 == 1u;
            phi_2601_ = _e617;
            if (_e617) {
                int _e618 = flags;
                phi_2601_ = (_e618 & 1) != 0;
            }
            bool _e622 = phi_2601_;
            if (_e622) {
                int _e623 = i;
                int _e624 = i;
                param_106 = _e624;
                float _e626 = c_7.height;
                param_107 = _e626;
                metal::float4 _e629 = unnamed.u_layerC.inner[_e623];
                param_108 = _e629.zw;
                metal::float4 _e631 = cspWaterColour_u0028_i1_u003b_f1_u003b_vf2_u003b(param_106, param_107, param_108, unnamed);
                local_16 = _e631;
            } else {
                uint _e632 = waterClass;
                bool _e633 = _e632 == 2u;
                phi_2624_ = _e633;
                if (_e633) {
                    int _e634 = flags;
                    phi_2624_ = (_e634 & 4) != 0;
                }
                bool _e638 = phi_2624_;
                if (_e638) {
                    int _e639 = i;
                    int _e640 = i;
                    param_109 = _e640;
                    float _e642 = c_7.height;
                    param_110 = _e642;
                    metal::float4 _e645 = unnamed.u_layerD.inner[_e639];
                    param_111 = _e645.xy;
                    metal::float4 _e647 = cspPaletteRange_u0028_i1_u003b_f1_u003b_vf2_u003b(param_109, param_110, param_111, unnamed);
                    local_17 = _e647;
                } else {
                    int _e648 = i;
                    param_112 = _e648;
                    float _e650 = v_7[0u];
                    param_113 = _e650;
                    metal::float4 _e651 = cspPalette_u0028_i1_u003b_f1_u003b(param_112, param_113, unnamed);
                    local_17 = _e651;
                }
                metal::float4 _e652 = local_17;
                local_16 = _e652;
            }
            metal::float4 _e653 = local_16;
            colour = _e653;
            int _e654 = style_2;
            int _e656 = style_2;
            float _e659 = param_101;
            if (((_e654 == 5) || (_e656 == 10)) && (_e659 > 0.0)) {
                float _e663 = unnamed.u_ambient;
                float _e665 = unnamed.u_ambient;
                float _e668 = c_7.sdx;
                param_114 = _e668;
                float _e670 = c_7.sdy;
                param_115 = _e670;
                float _e672 = unnamed.u_sunAzimuth;
                param_116 = _e672;
                float _e673 = cspDirectShade_u0028_f1_u003b_f1_u003b_f1_u003b(param_114, param_115, param_116, unnamed);
                shade = _e663 + ((1.0 - _e665) * _e673);
                metal::float4 _e676 = colour;
                float _e678 = shade;
                float _e681 = param_101;
                metal::float3 _e685 = metal::min(_e676.xyz * metal::mix(1.0, 0.33 + (0.82 * _e678), metal::clamp(_e681, 0.0, 1.0)), metal::float3(1.0, 1.0, 1.0));
                colour[0u] = _e685.x;
                colour[1u] = _e685.y;
                colour[2u] = _e685.z;
            }
            float _e693 = colour[3u];
            float _e695 = v_7[1u];
            float _e698 = layer_5[1u];
            alpha = metal::clamp((_e693 * _e695) * _e698, 0.0, 1.0);
            float _e701 = alpha;
            if (_e701 <= 0.0) {
                continue;
            }
            float _e704 = layer_5[2u];
            metal::float4 _e707 = acc;
            param_117 = _e707;
            metal::float4 _e708 = colour;
            param_118 = _e708.xyz;
            float _e710 = alpha;
            param_119 = _e710;
            param_120 = naga_f2i32(_e704 + 0.5);
            metal::float4 _e711 = cspComposite_u0028_vf4_u003b_vf3_u003b_f1_u003b_i1_u003b(param_117, param_118, param_119, param_120);
            acc = _e711;
            continue;
        } else {
            break;
        }
    }
    float _e715 = acc[3u];
    if (_e715 <= 0.0) {
        return metal::float4(0.0, 0.0, 0.0, 0.0);
    }
    metal::float4 _e717 = acc;
    float _e720 = acc[3u];
    param_121 = _e717.xyz / metal::float3(_e720);
    metal::float3 _e723 = cspApplyAppearance_u0028_vf3_u003b(param_121, unnamed);
    straight_1 = _e723;
    metal::float3 _e724 = straight_1;
    float _e726 = acc[3u];
    metal::float3 _e727 = _e724 * _e726;
    float _e729 = acc[3u];
    float _e735 = unnamed.u_terrainOpacity;
    return metal::float4(_e727.x, _e727.y, _e727.z, _e729) * _e735;
}

metal::float4 cspSpectrumColour_u0028_f1_u003b(
    thread float& value_6,
    constant CskUniforms& unnamed
) {
    metal::float4 result = {};
    float d_2 = {};
    float t_4 = {};
    float blend = {};
    metal::float3 white = {};
    metal::float3 target = {};
    metal::float3 local_18 = {};
    metal::float3 rgb = {};
    float a_3 = {};
    float belowCoverage = {};
    float local_19 = {};
    float aboveCoverage = {};
    float local_20 = {};
    float a_4 = {};
    float a_5 = {};
    float line = {};
    float a_6 = {};
    result = metal::float4(0.0, 0.0, 0.0, 0.0);
    float _e279 = unnamed.u_spectrumOn;
    if (_e279 > 0.5) {
        float _e281 = value_6;
        float _e283 = unnamed.u_spectrumLevel;
        float _e286 = unnamed.u_spectrumSpan;
        d_2 = (_e281 - _e283) / metal::max(1.0, _e286);
        float _e289 = d_2;
        t_4 = metal::clamp(metal::abs(_e289), 0.0, 1.0);
        float _e292 = t_4;
        float _e293 = t_4;
        float _e295 = t_4;
        blend = (_e292 * _e293) * (3.0 - (2.0 * _e295));
        metal::float3 _e300 = unnamed.u_spectrumMid;
        white = _e300;
        float _e301 = d_2;
        if (_e301 >= 0.0) {
            metal::float3 _e304 = unnamed.u_spectrumHigh;
            local_18 = _e304;
        } else {
            metal::float3 _e306 = unnamed.u_spectrumLow;
            local_18 = _e306;
        }
        metal::float3 _e307 = local_18;
        target = _e307;
        metal::float3 _e308 = white;
        metal::float3 _e309 = target;
        float _e310 = blend;
        rgb = metal::mix(_e308, _e309, metal::float3(_e310));
        float _e314 = unnamed.u_spectrumAlpha;
        float _e315 = t_4;
        a_3 = metal::clamp(_e314 * (0.15 + (0.85 * _e315)), 0.0, 1.0);
        metal::float3 _e320 = rgb;
        float _e321 = a_3;
        metal::float4 _e323 = result;
        float _e325 = a_3;
        metal::float3 _e328 = (_e320 * _e321) + (_e323.xyz * (1.0 - _e325));
        float _e329 = a_3;
        float _e331 = result[3u];
        float _e332 = a_3;
        result = metal::float4(_e328.x, _e328.y, _e328.z, _e329 + (_e331 * (1.0 - _e332)));
    }
    float _e341 = unnamed.u_bandFeather;
    if (_e341 > 0.0) {
        float _e344 = unnamed.u_belowLevel;
        float _e346 = unnamed.u_bandFeather;
        float _e350 = unnamed.u_belowLevel;
        float _e352 = unnamed.u_bandFeather;
        float _e355 = value_6;
        local_19 = 1.0 - metal::smoothstep(_e344 - (_e346 * 0.5), _e350 + (_e352 * 0.5), _e355);
    } else {
        float _e358 = value_6;
        float _e360 = unnamed.u_belowLevel;
        local_19 = metal::step(_e358, _e360);
    }
    float _e362 = local_19;
    belowCoverage = _e362;
    float _e364 = unnamed.u_bandFeather;
    if (_e364 > 0.0) {
        float _e367 = unnamed.u_aboveLevel;
        float _e369 = unnamed.u_bandFeather;
        float _e373 = unnamed.u_aboveLevel;
        float _e375 = unnamed.u_bandFeather;
        float _e378 = value_6;
        local_20 = metal::smoothstep(_e367 - (_e369 * 0.5), _e373 + (_e375 * 0.5), _e378);
    } else {
        float _e381 = unnamed.u_aboveLevel;
        float _e382 = value_6;
        local_20 = metal::step(_e381, _e382);
    }
    float _e384 = local_20;
    aboveCoverage = _e384;
    float _e386 = unnamed.u_belowOn;
    if (_e386 > 0.5) {
        float _e389 = unnamed.u_bandAlpha;
        float _e390 = belowCoverage;
        a_4 = metal::clamp(_e389 * _e390, 0.0, 1.0);
        metal::float3 _e394 = unnamed.u_belowColor;
        float _e395 = a_4;
        metal::float4 _e397 = result;
        float _e399 = a_4;
        metal::float3 _e402 = (_e394 * _e395) + (_e397.xyz * (1.0 - _e399));
        float _e403 = a_4;
        float _e405 = result[3u];
        float _e406 = a_4;
        result = metal::float4(_e402.x, _e402.y, _e402.z, _e403 + (_e405 * (1.0 - _e406)));
    }
    float _e415 = unnamed.u_aboveOn;
    if (_e415 > 0.5) {
        float _e418 = unnamed.u_bandAlpha;
        float _e419 = aboveCoverage;
        a_5 = metal::clamp(_e418 * _e419, 0.0, 1.0);
        metal::float3 _e423 = unnamed.u_aboveColor;
        float _e424 = a_5;
        metal::float4 _e426 = result;
        float _e428 = a_5;
        metal::float3 _e431 = (_e423 * _e424) + (_e426.xyz * (1.0 - _e428));
        float _e432 = a_5;
        float _e434 = result[3u];
        float _e435 = a_5;
        result = metal::float4(_e431.x, _e431.y, _e431.z, _e432 + (_e434 * (1.0 - _e435)));
    }
    float _e444 = unnamed.u_outlineOn;
    if (_e444 > 0.5) {
        line = 0.0;
        float _e447 = unnamed.u_belowOn;
        if (_e447 > 0.5) {
            float _e449 = line;
            float _e451 = unnamed.u_outlineWidth;
            float _e454 = value_6;
            float _e456 = unnamed.u_belowLevel;
            line = metal::max(_e449, 1.0 - metal::smoothstep(0.0, metal::max(0.001, _e451 * 0.5), metal::abs(_e454 - _e456)));
        }
        float _e463 = unnamed.u_aboveOn;
        if (_e463 > 0.5) {
            float _e465 = line;
            float _e467 = unnamed.u_outlineWidth;
            float _e470 = value_6;
            float _e472 = unnamed.u_aboveLevel;
            line = metal::max(_e465, 1.0 - metal::smoothstep(0.0, metal::max(0.001, _e467 * 0.5), metal::abs(_e470 - _e472)));
        }
        float _e478 = line;
        a_6 = metal::clamp(0.88 * _e478, 0.0, 1.0);
        float _e481 = a_6;
        metal::float4 _e483 = result;
        float _e485 = a_6;
        metal::float3 _e488 = (metal::float3(1.0, 1.0, 1.0) * _e481) + (_e483.xyz * (1.0 - _e485));
        float _e489 = a_6;
        float _e491 = result[3u];
        float _e492 = a_6;
        result = metal::float4(_e488.x, _e488.y, _e488.z, _e489 + (_e491 * (1.0 - _e492)));
    }
    metal::float4 _e500 = result;
    return _e500;
}

metal::int2 naga_f2i32(metal::float2 value) {
    return static_cast<metal::int2>(metal::clamp(value, -2147483600.0, 2147483500.0));
}

void main_1(
    metal::texture2d<float, metal::access::sample> csk_heights,
    metal::texture2d<uint, metal::access::sample> csk_ranks,
    metal::texture2d<float, metal::access::sample> csk_blur,
    metal::texture2d<float, metal::access::sample> csk_base,
    metal::texture2d<float, metal::access::sample> csk_land,
    constant CskUniforms& unnamed,
    metal::texture2d<uint, metal::access::sample> u_waterMask,
    thread metal::float2& v_screenUv_1,
    thread metal::float4& fragColor
) {
    metal::int2 size = {};
    metal::int2 p_9 = {};
    metal::int2 param_122 = {};
    float value_7 = {};
    metal::int2 param_123 = {};
    metal::float2 cssOffset = {};
    float cosB_1 = {};
    float sinB_1 = {};
    float worldCss = {};
    metal::float2 merc_2 = {};
    float lat = {};
    float mpp = {};
    float groundRes_1 = {};
    float local_21 = {};
    metal::float4 spectrum = {};
    float param_124 = {};
    metal::float4 terrain = {};
    metal::int2 param_125 = {};
    float param_126 = {};
    float param_127 = {};
    float param_128 = {};
    float param_129 = {};
    metal::float2 param_130 = {};
    metal::int2 px_1 = {};
    metal::int2 py_1 = {};
    bool allValid = {};
    metal::int2 param_131 = {};
    metal::int2 param_132 = {};
    metal::int2 param_133 = {};
    metal::int2 param_134 = {};
    metal::int2 param_135 = {};
    metal::int2 param_136 = {};
    metal::int2 param_137 = {};
    metal::int2 param_138 = {};
    float a_7 = {};
    metal::int2 param_139 = {};
    float b_7 = {};
    metal::int2 param_140 = {};
    float c_8 = {};
    metal::int2 param_141 = {};
    float d_3 = {};
    metal::int2 param_142 = {};
    float f_1 = {};
    metal::int2 param_143 = {};
    float g_1 = {};
    metal::int2 param_144 = {};
    float q_3 = {};
    metal::int2 param_145 = {};
    float k_3 = {};
    metal::int2 param_146 = {};
    bool shaded = {};
    float zFactor_1 = {};
    float res = {};
    float local_22 = {};
    float dxS_1 = {};
    float dyS_1 = {};
    float dx_4 = {};
    float north_1 = {};
    float dy_4 = {};
    metal::float4 colour_1 = {};
    bool painted = {};
    float param_147 = {};
    float param_148 = {};
    float param_149 = {};
    float param_150 = {};
    float northness = {};
    float param_151 = {};
    float param_152 = {};
    float amount = {};
    metal::float3 neutral = {};
    metal::float3 target_1 = {};
    float interval_1 = {};
    float local_23 = {};
    float local_24 = {};
    float perPixel_1 = {};
    float spacing_1 = {};
    float multiple_1 = {};
    float distanceToLine_1 = {};
    float lineWidth_1 = {};
    bool indexLine_1 = {};
    float shade_1 = {};
    float param_153 = {};
    float param_154 = {};
    float param_155 = {};
    float param_156 = {};
    float aspect_1 = {};
    float param_157 = {};
    float param_158 = {};
    float sum_1 = {};
    float total_1 = {};
    int index_1 = {};
    float az_2 = {};
    float s_6 = {};
    float weight_1 = {};
    float local_25 = {};
    float param_159 = {};
    float param_160 = {};
    float param_161 = {};
    float direct = {};
    float shade_2 = {};
    float direct_1 = {};
    float param_162 = {};
    float param_163 = {};
    float param_164 = {};
    float shade_3 = {};
    metal::float3 straight_2 = {};
    metal::float3 local_26 = {};
    metal::float3 param_165 = {};
    bool phi_2923_ = {};
    bool phi_2933_ = {};
    bool phi_2941_ = {};
    bool phi_2949_ = {};
    bool phi_2959_ = {};
    bool phi_2967_ = {};
    bool phi_2977_ = {};
    bool phi_3047_ = {};
    bool phi_3054_ = {};
    metal::int2 _e368 = csp_size_u0028_(csk_heights);
    size = _e368;
    metal::float2 _e369 = v_screenUv_1;
    metal::int2 _e370 = size;
    metal::int2 _e375 = size;
    p_9 = metal::clamp(naga_f2i32(metal::floor(_e369 * static_cast<metal::float2>(_e370))), metal::int2(0, 0), as_type<metal::int2>(as_type<metal::uint2>(_e375) - as_type<metal::uint2>(metal::int2(1, 1))));
    metal::int2 _e378 = p_9;
    param_122 = _e378;
    bool _e379 = csp_valid_u0028_vi2_u003b(param_122, csk_heights, csk_ranks);
    if (!(_e379)) {
        fragColor = metal::float4(0.0, 0.0, 0.0, 0.0);
        return;
    }
    metal::int2 _e381 = p_9;
    param_123 = _e381;
    float _e382 = csp_height_u0028_vi2_u003b(param_123, csk_heights);
    value_7 = _e382;
    metal::float2 _e383 = v_screenUv_1;
    metal::float2 _e387 = unnamed.u_cssSize;
    cssOffset = (_e383 - metal::float2(0.5)) * _e387;
    float _e390 = unnamed.u_bearingRad;
    cosB_1 = metal::cos(_e390);
    float _e393 = unnamed.u_bearingRad;
    sinB_1 = metal::sin(_e393);
    float _e396 = unnamed.u_zoom;
    worldCss = 256.0 * metal::exp2(_e396);
    metal::float2 _e400 = unnamed.u_centerMerc;
    float _e402 = cssOffset[0u];
    float _e403 = cosB_1;
    float _e406 = cssOffset[1u];
    float _e407 = sinB_1;
    float _e411 = cssOffset[0u];
    float _e413 = sinB_1;
    float _e416 = cssOffset[1u];
    float _e417 = cosB_1;
    float _e421 = worldCss;
    merc_2 = _e400 + (metal::float2((_e402 * _e403) + (_e406 * _e407), (-(_e411) * _e413) + (_e416 * _e417)) / metal::float2(_e421));
    float _e426 = merc_2[1u];
    lat = metal::atan(metal::sinh(3.1415927 * (1.0 - (2.0 * _e426))));
    float _e432 = lat;
    float _e436 = unnamed.u_zoom;
    float _e440 = unnamed.u_dpr;
    mpp = (40075016.0 * metal::cos(_e432)) / ((256.0 * metal::exp2(_e436)) * _e440);
    float _e444 = unnamed.u_groundResOverride;
    if (_e444 > 0.0) {
        float _e447 = unnamed.u_groundResOverride;
        local_21 = _e447;
    } else {
        float _e448 = mpp;
        local_21 = _e448;
    }
    float _e449 = local_21;
    groundRes_1 = _e449;
    float _e450 = value_7;
    param_124 = _e450;
    metal::float4 _e451 = cspSpectrumColour_u0028_f1_u003b(param_124, unnamed);
    float _e453 = unnamed.u_spectrumOpacity;
    spectrum = _e451 * _e453;
    terrain = metal::float4(0.0, 0.0, 0.0, 0.0);
    float _e456 = unnamed.u_stackOn;
    if (_e456 > 0.5) {
        metal::int2 _e458 = p_9;
        param_125 = _e458;
        float _e459 = value_7;
        param_126 = _e459;
        float _e460 = groundRes_1;
        param_127 = _e460;
        float _e461 = cosB_1;
        param_128 = _e461;
        float _e462 = sinB_1;
        param_129 = _e462;
        metal::float2 _e463 = merc_2;
        param_130 = _e463;
        metal::float4 _e464 = cspStack_u0028_vi2_u003b_f1_u003b_f1_u003b_f1_u003b_f1_u003b_vf2_u003b(param_125, param_126, param_127, param_128, param_129, param_130, csk_heights, csk_ranks, csk_blur, csk_base, csk_land, unnamed, u_waterMask);
        terrain = _e464;
    } else {
        int _e466 = unnamed.u_style;
        if (_e466 >= 0) {
            px_1 = metal::int2(1, 0);
            py_1 = metal::int2(0, 1);
            metal::int2 _e468 = p_9;
            metal::int2 _e469 = px_1;
            metal::int2 _e471 = py_1;
            param_131 = as_type<metal::int2>(as_type<metal::uint2>(as_type<metal::int2>(as_type<metal::uint2>(_e468) - as_type<metal::uint2>(_e469))) - as_type<metal::uint2>(_e471));
            bool _e473 = csp_valid_u0028_vi2_u003b(param_131, csk_heights, csk_ranks);
            phi_2923_ = _e473;
            if (_e473) {
                metal::int2 _e474 = p_9;
                metal::int2 _e475 = py_1;
                param_132 = as_type<metal::int2>(as_type<metal::uint2>(_e474) - as_type<metal::uint2>(_e475));
                bool _e477 = csp_valid_u0028_vi2_u003b(param_132, csk_heights, csk_ranks);
                phi_2923_ = _e477;
            }
            bool _e479 = phi_2923_;
            phi_2933_ = _e479;
            if (_e479) {
                metal::int2 _e480 = p_9;
                metal::int2 _e481 = px_1;
                metal::int2 _e483 = py_1;
                param_133 = as_type<metal::int2>(as_type<metal::uint2>(as_type<metal::int2>(as_type<metal::uint2>(_e480) + as_type<metal::uint2>(_e481))) - as_type<metal::uint2>(_e483));
                bool _e485 = csp_valid_u0028_vi2_u003b(param_133, csk_heights, csk_ranks);
                phi_2933_ = _e485;
            }
            bool _e487 = phi_2933_;
            phi_2941_ = _e487;
            if (_e487) {
                metal::int2 _e488 = p_9;
                metal::int2 _e489 = px_1;
                param_134 = as_type<metal::int2>(as_type<metal::uint2>(_e488) - as_type<metal::uint2>(_e489));
                bool _e491 = csp_valid_u0028_vi2_u003b(param_134, csk_heights, csk_ranks);
                phi_2941_ = _e491;
            }
            bool _e493 = phi_2941_;
            phi_2949_ = _e493;
            if (_e493) {
                metal::int2 _e494 = p_9;
                metal::int2 _e495 = px_1;
                param_135 = as_type<metal::int2>(as_type<metal::uint2>(_e494) + as_type<metal::uint2>(_e495));
                bool _e497 = csp_valid_u0028_vi2_u003b(param_135, csk_heights, csk_ranks);
                phi_2949_ = _e497;
            }
            bool _e499 = phi_2949_;
            phi_2959_ = _e499;
            if (_e499) {
                metal::int2 _e500 = p_9;
                metal::int2 _e501 = px_1;
                metal::int2 _e503 = py_1;
                param_136 = as_type<metal::int2>(as_type<metal::uint2>(as_type<metal::int2>(as_type<metal::uint2>(_e500) - as_type<metal::uint2>(_e501))) + as_type<metal::uint2>(_e503));
                bool _e505 = csp_valid_u0028_vi2_u003b(param_136, csk_heights, csk_ranks);
                phi_2959_ = _e505;
            }
            bool _e507 = phi_2959_;
            phi_2967_ = _e507;
            if (_e507) {
                metal::int2 _e508 = p_9;
                metal::int2 _e509 = py_1;
                param_137 = as_type<metal::int2>(as_type<metal::uint2>(_e508) + as_type<metal::uint2>(_e509));
                bool _e511 = csp_valid_u0028_vi2_u003b(param_137, csk_heights, csk_ranks);
                phi_2967_ = _e511;
            }
            bool _e513 = phi_2967_;
            phi_2977_ = _e513;
            if (_e513) {
                metal::int2 _e514 = p_9;
                metal::int2 _e515 = px_1;
                metal::int2 _e517 = py_1;
                param_138 = as_type<metal::int2>(as_type<metal::uint2>(as_type<metal::int2>(as_type<metal::uint2>(_e514) + as_type<metal::uint2>(_e515))) + as_type<metal::uint2>(_e517));
                bool _e519 = csp_valid_u0028_vi2_u003b(param_138, csk_heights, csk_ranks);
                phi_2977_ = _e519;
            }
            bool _e521 = phi_2977_;
            allValid = _e521;
            bool _e522 = allValid;
            if (_e522) {
                metal::int2 _e523 = p_9;
                metal::int2 _e524 = px_1;
                metal::int2 _e526 = py_1;
                param_139 = as_type<metal::int2>(as_type<metal::uint2>(as_type<metal::int2>(as_type<metal::uint2>(_e523) - as_type<metal::uint2>(_e524))) - as_type<metal::uint2>(_e526));
                float _e528 = csp_height_u0028_vi2_u003b(param_139, csk_heights);
                a_7 = _e528;
                metal::int2 _e529 = p_9;
                metal::int2 _e530 = py_1;
                param_140 = as_type<metal::int2>(as_type<metal::uint2>(_e529) - as_type<metal::uint2>(_e530));
                float _e532 = csp_height_u0028_vi2_u003b(param_140, csk_heights);
                b_7 = _e532;
                metal::int2 _e533 = p_9;
                metal::int2 _e534 = px_1;
                metal::int2 _e536 = py_1;
                param_141 = as_type<metal::int2>(as_type<metal::uint2>(as_type<metal::int2>(as_type<metal::uint2>(_e533) + as_type<metal::uint2>(_e534))) - as_type<metal::uint2>(_e536));
                float _e538 = csp_height_u0028_vi2_u003b(param_141, csk_heights);
                c_8 = _e538;
                metal::int2 _e539 = p_9;
                metal::int2 _e540 = px_1;
                param_142 = as_type<metal::int2>(as_type<metal::uint2>(_e539) - as_type<metal::uint2>(_e540));
                float _e542 = csp_height_u0028_vi2_u003b(param_142, csk_heights);
                d_3 = _e542;
                metal::int2 _e543 = p_9;
                metal::int2 _e544 = px_1;
                param_143 = as_type<metal::int2>(as_type<metal::uint2>(_e543) + as_type<metal::uint2>(_e544));
                float _e546 = csp_height_u0028_vi2_u003b(param_143, csk_heights);
                f_1 = _e546;
                metal::int2 _e547 = p_9;
                metal::int2 _e548 = px_1;
                metal::int2 _e550 = py_1;
                param_144 = as_type<metal::int2>(as_type<metal::uint2>(as_type<metal::int2>(as_type<metal::uint2>(_e547) - as_type<metal::uint2>(_e548))) + as_type<metal::uint2>(_e550));
                float _e552 = csp_height_u0028_vi2_u003b(param_144, csk_heights);
                g_1 = _e552;
                metal::int2 _e553 = p_9;
                metal::int2 _e554 = py_1;
                param_145 = as_type<metal::int2>(as_type<metal::uint2>(_e553) + as_type<metal::uint2>(_e554));
                float _e556 = csp_height_u0028_vi2_u003b(param_145, csk_heights);
                q_3 = _e556;
                metal::int2 _e557 = p_9;
                metal::int2 _e558 = px_1;
                metal::int2 _e560 = py_1;
                param_146 = as_type<metal::int2>(as_type<metal::uint2>(as_type<metal::int2>(as_type<metal::uint2>(_e557) + as_type<metal::uint2>(_e558))) + as_type<metal::uint2>(_e560));
                float _e562 = csp_height_u0028_vi2_u003b(param_146, csk_heights);
                k_3 = _e562;
                int _e564 = unnamed.u_style;
                bool _e565 = _e564 == 0;
                phi_3047_ = _e565;
                if (!(_e565)) {
                    int _e568 = unnamed.u_style;
                    phi_3047_ = _e568 == 1;
                }
                bool _e571 = phi_3047_;
                phi_3054_ = _e571;
                if (!(_e571)) {
                    int _e574 = unnamed.u_style;
                    phi_3054_ = _e574 == 5;
                }
                bool _e577 = phi_3054_;
                shaded = _e577;
                float _e578 = groundRes_1;
                zFactor_1 = 1.0 + (0.024 * metal::pow(metal::max(_e578, 0.0), 0.664));
                bool _e583 = shaded;
                if (_e583) {
                    float _e584 = groundRes_1;
                    float _e585 = zFactor_1;
                    local_22 = _e584 / _e585;
                } else {
                    float _e587 = groundRes_1;
                    local_22 = _e587;
                }
                float _e588 = local_22;
                res = _e588;
                float _e589 = c_8;
                float _e590 = f_1;
                float _e593 = k_3;
                float _e595 = a_7;
                float _e596 = d_3;
                float _e599 = g_1;
                float _e602 = res;
                dxS_1 = (((_e589 + (2.0 * _e590)) + _e593) - ((_e595 + (2.0 * _e596)) + _e599)) / (8.0 * _e602);
                float _e605 = g_1;
                float _e606 = q_3;
                float _e609 = k_3;
                float _e611 = a_7;
                float _e612 = b_7;
                float _e615 = c_8;
                float _e618 = res;
                dyS_1 = (((_e605 + (2.0 * _e606)) + _e609) - ((_e611 + (2.0 * _e612)) + _e615)) / (8.0 * _e618);
                float _e621 = dxS_1;
                float _e622 = cosB_1;
                float _e624 = dyS_1;
                float _e625 = sinB_1;
                dx_4 = (_e621 * _e622) + (_e624 * _e625);
                float _e628 = dxS_1;
                float _e629 = sinB_1;
                float _e631 = dyS_1;
                float _e632 = cosB_1;
                north_1 = (_e628 * _e629) - (_e631 * _e632);
                float _e635 = north_1;
                dy_4 = -(_e635);
                colour_1 = metal::float4(0.0, 0.0, 0.0, 0.0);
                painted = true;
                int _e638 = unnamed.u_style;
                if (_e638 == 2) {
                    float _e640 = dx_4;
                    float _e641 = dy_4;
                    param_147 = ((metal::atan(metal::length(metal::float2(_e640, _e641)))) * 57.295779513082322865);
                    metal::float3 _e646 = cspSlopeColour_u0028_f1_u003b(param_147);
                    colour_1 = metal::float4(_e646.x, _e646.y, _e646.z, 1.0);
                } else {
                    int _e652 = unnamed.u_style;
                    if (_e652 == 3) {
                        float _e654 = dx_4;
                        float _e655 = dy_4;
                        if (metal::length(metal::float2(_e654, _e655)) <= 0.008726868) {
                            painted = false;
                        } else {
                            float _e659 = dx_4;
                            param_148 = _e659;
                            float _e660 = dy_4;
                            param_149 = _e660;
                            float _e661 = cspAspectOf_u0028_f1_u003b_f1_u003b(param_148, param_149);
                            param_150 = _e661;
                            metal::float3 _e662 = cspAspectColour_u0028_f1_u003b(param_150);
                            colour_1 = metal::float4(_e662.x, _e662.y, _e662.z, 1.0);
                        }
                    } else {
                        int _e668 = unnamed.u_style;
                        if (_e668 == 4) {
                            float _e670 = dx_4;
                            float _e671 = dy_4;
                            if (metal::length(metal::float2(_e670, _e671)) <= 0.008726868) {
                                painted = false;
                            } else {
                                float _e675 = dx_4;
                                param_151 = _e675;
                                float _e676 = dy_4;
                                param_152 = _e676;
                                float _e677 = cspAspectOf_u0028_f1_u003b_f1_u003b(param_151, param_152);
                                northness = metal::cos(((_e677) * 0.017453292519943295474));
                                float _e680 = northness;
                                amount = metal::abs(_e680);
                                neutral = metal::float3(0.96862745, 0.9529412, 0.8784314);
                                float _e682 = northness;
                                target_1 = metal::select(metal::float3(214.0, 82.0, 78.0), metal::float3(55.0, 137.0, 92.0), metal::bool3(_e682 >= 0.0)) / metal::float3(255.0);
                                metal::float3 _e688 = neutral;
                                metal::float3 _e689 = target_1;
                                float _e690 = amount;
                                metal::float3 _e692 = metal::mix(_e688, _e689, metal::float3(_e690));
                                colour_1 = metal::float4(_e692.x, _e692.y, _e692.z, 1.0);
                            }
                        } else {
                            int _e698 = unnamed.u_style;
                            if (_e698 >= 6) {
                                int _e701 = unnamed.u_style;
                                if (_e701 == 6) {
                                    local_23 = 2.0;
                                } else {
                                    int _e704 = unnamed.u_style;
                                    if (_e704 == 7) {
                                        local_24 = 5.0;
                                    } else {
                                        int _e707 = unnamed.u_style;
                                        local_24 = (_e707 == 8) ? 10.0 : 25.0;
                                    }
                                    float _e710 = local_24;
                                    local_23 = _e710;
                                }
                                float _e711 = local_23;
                                interval_1 = _e711;
                                float _e712 = dx_4;
                                float _e713 = dy_4;
                                float _e716 = res;
                                perPixel_1 = (metal::length(metal::float2(_e712, _e713)) * _e716) * 3.28084;
                                float _e719 = perPixel_1;
                                if (_e719 > 0.0) {
                                    float _e721 = interval_1;
                                    float _e722 = perPixel_1;
                                    spacing_1 = _e721 / _e722;
                                    float _e724 = spacing_1;
                                    if (_e724 < 3.0) {
                                        float _e726 = spacing_1;
                                        if ((_e726 * 5.0) >= 3.0) {
                                            float _e729 = interval_1;
                                            interval_1 = _e729 * 5.0;
                                        } else {
                                            painted = false;
                                        }
                                    }
                                }
                                bool _e731 = painted;
                                if (_e731) {
                                    float _e732 = value_7;
                                    float _e734 = interval_1;
                                    multiple_1 = (_e732 * 3.28084) / _e734;
                                    float _e736 = multiple_1;
                                    float _e737 = multiple_1;
                                    float _e741 = interval_1;
                                    distanceToLine_1 = metal::abs(_e736 - metal::rint(_e737)) * _e741;
                                    float _e743 = interval_1;
                                    float _e745 = perPixel_1;
                                    lineWidth_1 = metal::max(0.35, metal::min(_e743 * 0.5, _e745 * 0.7));
                                    float _e749 = distanceToLine_1;
                                    float _e750 = lineWidth_1;
                                    if (_e749 >= _e750) {
                                        painted = false;
                                    } else {
                                        float _e752 = multiple_1;
                                        float _e753 = metal::rint(_e752);
                                        indexLine_1 = metal::abs(_e753 - (metal::floor(_e753 / 5.0) * 5.0)) < 0.5;
                                        bool _e760 = indexLine_1;
                                        colour_1 = metal::select(metal::float4(0.5882353, 0.43137255, 0.3137255, 0.78431374), metal::float4(0.47058824, 0.27450982, 0.15686275, 1.0), metal::bool4(_e760));
                                    }
                                }
                            } else {
                                int _e764 = unnamed.u_style;
                                if (_e764 == 5) {
                                    float _e767 = unnamed.u_ambient;
                                    float _e769 = unnamed.u_ambient;
                                    float _e771 = dx_4;
                                    param_153 = _e771;
                                    float _e772 = dy_4;
                                    param_154 = _e772;
                                    float _e774 = unnamed.u_sunAzimuth;
                                    param_155 = _e774;
                                    float _e775 = cspDirectShade_u0028_f1_u003b_f1_u003b_f1_u003b(param_153, param_154, param_155, unnamed);
                                    shade_1 = _e767 + ((1.0 - _e769) * _e775);
                                    float _e778 = value_7;
                                    param_156 = _e778;
                                    metal::float3 _e779 = cspTintColour_u0028_f1_u003b(param_156);
                                    float _e780 = shade_1;
                                    metal::float3 _e784 = metal::min(_e779 * (0.33 + (0.82 * _e780)), metal::float3(1.0, 1.0, 1.0));
                                    colour_1 = metal::float4(_e784.x, _e784.y, _e784.z, 1.0);
                                } else {
                                    int _e790 = unnamed.u_style;
                                    if (_e790 == 1) {
                                        float _e792 = dx_4;
                                        param_157 = _e792;
                                        float _e793 = dy_4;
                                        param_158 = _e793;
                                        float _e794 = cspAspectOf_u0028_f1_u003b_f1_u003b(param_157, param_158);
                                        aspect_1 = _e794;
                                        sum_1 = 0.0;
                                        total_1 = 0.0;
                                        index_1 = 0;
                                        uint2 loop_bound_3 = uint2(4294967295u);
                                        bool loop_init_3 = true;
                                        while(true) {
                                            if (metal::all(loop_bound_3 == uint2(0u))) { break; }
                                            loop_bound_3 -= uint2(loop_bound_3.y == 0u, 1u);
                                            if (!loop_init_3) {
                                                int _e833 = index_1;
                                                index_1 = as_type<int>(as_type<uint>(_e833) + as_type<uint>(1));
                                            }
                                            loop_init_3 = false;
                                            int _e795 = index_1;
                                            if (_e795 < 4) {
                                                float _e798 = unnamed.u_sunAzimuth;
                                                int _e800 = index_1;
                                                az_2 = (_e798 - 90.0) + (45.0 * static_cast<float>(_e800));
                                                float _e804 = aspect_1;
                                                float _e805 = az_2;
                                                s_6 = metal::sin((((_e804 - (_e805 - (metal::floor(_e805 / 360.0) * 360.0)))) * 0.017453292519943295474));
                                                float _e813 = dx_4;
                                                float _e814 = dy_4;
                                                if (metal::length(metal::float2(_e813, _e814)) < 0.000000000001) {
                                                    local_25 = 1.0;
                                                } else {
                                                    float _e818 = s_6;
                                                    float _e819 = s_6;
                                                    local_25 = _e818 * _e819;
                                                }
                                                float _e821 = local_25;
                                                weight_1 = _e821;
                                                float _e822 = weight_1;
                                                float _e823 = dx_4;
                                                param_159 = _e823;
                                                float _e824 = dy_4;
                                                param_160 = _e824;
                                                float _e825 = az_2;
                                                param_161 = _e825;
                                                float _e826 = cspDirectShade_u0028_f1_u003b_f1_u003b_f1_u003b(param_159, param_160, param_161, unnamed);
                                                float _e828 = sum_1;
                                                sum_1 = _e828 + (_e822 * _e826);
                                                float _e830 = weight_1;
                                                float _e831 = total_1;
                                                total_1 = _e831 + _e830;
                                                continue;
                                            } else {
                                                break;
                                            }
                                        }
                                        float _e835 = sum_1;
                                        float _e836 = total_1;
                                        direct = _e835 / metal::max(_e836, 0.00001);
                                        float _e840 = unnamed.u_ambient;
                                        float _e842 = unnamed.u_ambient;
                                        float _e844 = direct;
                                        shade_2 = _e840 + ((1.0 - _e842) * _e844);
                                        float _e847 = shade_2;
                                        metal::float3 _e848 = metal::float3(_e847);
                                        colour_1 = metal::float4(_e848.x, _e848.y, _e848.z, 1.0);
                                    } else {
                                        float _e853 = dx_4;
                                        param_162 = _e853;
                                        float _e854 = dy_4;
                                        param_163 = _e854;
                                        float _e856 = unnamed.u_sunAzimuth;
                                        param_164 = _e856;
                                        float _e857 = cspDirectShade_u0028_f1_u003b_f1_u003b_f1_u003b(param_162, param_163, param_164, unnamed);
                                        direct_1 = _e857;
                                        float _e859 = unnamed.u_ambient;
                                        float _e861 = unnamed.u_ambient;
                                        float _e863 = direct_1;
                                        shade_3 = _e859 + ((1.0 - _e861) * _e863);
                                        float _e866 = shade_3;
                                        metal::float3 _e867 = metal::float3(_e866);
                                        colour_1 = metal::float4(_e867.x, _e867.y, _e867.z, 1.0);
                                    }
                                }
                            }
                        }
                    }
                }
                bool _e872 = painted;
                if (_e872) {
                    float _e874 = colour_1[3u];
                    if (_e874 > 0.0) {
                        metal::float4 _e876 = colour_1;
                        param_165 = _e876.xyz;
                        metal::float3 _e878 = cspApplyAppearance_u0028_vf3_u003b(param_165, unnamed);
                        local_26 = _e878;
                    } else {
                        local_26 = metal::float3(0.0, 0.0, 0.0);
                    }
                    metal::float3 _e879 = local_26;
                    straight_2 = _e879;
                    metal::float3 _e880 = straight_2;
                    float _e882 = colour_1[3u];
                    metal::float3 _e883 = _e880 * _e882;
                    float _e885 = colour_1[3u];
                    float _e891 = unnamed.u_terrainOpacity;
                    terrain = metal::float4(_e883.x, _e883.y, _e883.z, _e885) * _e891;
                }
            }
        }
    }
    metal::float4 _e893 = spectrum;
    metal::float4 _e894 = terrain;
    float _e896 = spectrum[3u];
    fragColor = _e893 + (_e894 * (1.0 - _e896));
    return;
}

struct main_Input {
    metal::float2 v_screenUv [[user(loc0), center_perspective]];
};
struct main_Output {
    metal::float4 member [[color(0)]];
};
fragment main_Output main_(
  main_Input varyings [[stage_in]]
, metal::texture2d<float, metal::access::sample> csk_heights [[texture(1)]]
, metal::texture2d<uint, metal::access::sample> csk_ranks [[texture(2)]]
, metal::texture2d<float, metal::access::sample> csk_blur [[texture(4)]]
, metal::texture2d<float, metal::access::sample> csk_base [[texture(5)]]
, metal::texture2d<float, metal::access::sample> csk_land [[texture(6)]]
, constant CskUniforms& unnamed [[buffer(0)]]
, metal::texture2d<uint, metal::access::sample> u_waterMask [[texture(3)]]
) {
    metal::float2 v_screenUv_1 = {};
    metal::float4 fragColor = {};
    const auto v_screenUv = varyings.v_screenUv;
    v_screenUv_1 = v_screenUv;
    main_1(csk_heights, csk_ranks, csk_blur, csk_base, csk_land, unnamed, u_waterMask, v_screenUv_1, fragColor);
    metal::float4 _e3 = fragColor;
    return main_Output { _e3 };
}
