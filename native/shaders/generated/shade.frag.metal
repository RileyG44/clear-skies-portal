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
struct type_17 {
    metal::float4 inner[4];
};
struct type_18 {
    metal::float4 inner[12];
};
struct type_19 {
    metal::float4 inner[40];
};
struct CskUniforms {
    float csk_blurScale;
    float csk_pad_csk_blurScale_1_;
    float csk_pad_csk_blurScale_2_;
    float csk_pad_csk_blurScale_3_;
    float csk_baseScale;
    float csk_pad_csk_baseScale_1_;
    float csk_pad_csk_baseScale_2_;
    float csk_pad_csk_baseScale_3_;
    float csk_landBaseScale;
    float csk_pad_csk_landBaseScale_1_;
    float csk_pad_csk_landBaseScale_2_;
    float csk_pad_csk_landBaseScale_3_;
    metal::float3x3 csk_auxTransform;
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
    type_17 u_layerA;
    type_17 u_layerB;
    type_17 u_layerC;
    type_17 u_layerD;
    type_18 u_layerPos;
    type_19 u_layerColors;
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
    float _e268 = unnamed.u_lookSaturation;
    s = _e268;
    float _e269 = s;
    float _e273 = straight[0u];
    float _e275 = s;
    float _e279 = straight[1u];
    float _e282 = s;
    float _e286 = straight[2u];
    float _e289 = s;
    float _e293 = straight[0u];
    float _e295 = s;
    float _e299 = straight[1u];
    float _e302 = s;
    float _e306 = straight[2u];
    float _e309 = s;
    float _e313 = straight[0u];
    float _e315 = s;
    float _e319 = straight[1u];
    float _e322 = s;
    float _e326 = straight[2u];
    c = metal::float3((((0.213 + (0.787 * _e269)) * _e273) + ((0.715 - (0.715 * _e275)) * _e279)) + ((0.072 - (0.072 * _e282)) * _e286), (((0.213 - (0.213 * _e289)) * _e293) + ((0.715 + (0.285 * _e295)) * _e299)) + ((0.072 - (0.072 * _e302)) * _e306), (((0.213 - (0.213 * _e309)) * _e313) + ((0.715 - (0.715 * _e315)) * _e319)) + ((0.072 + (0.928 * _e322)) * _e326));
    metal::float3 _e330 = c;
    c = metal::clamp(_e330, metal::float3(0.0), metal::float3(1.0));
    metal::float3 _e334 = c;
    float _e336 = unnamed.u_lookContrast;
    float _e339 = unnamed.u_lookContrast;
    c = metal::clamp((_e334 * _e336) + metal::float3((1.0 - _e339) * 0.5), metal::float3(0.0), metal::float3(1.0));
    metal::float3 _e347 = c;
    float _e349 = unnamed.u_lookBrightness;
    c = metal::clamp(_e347 * _e349, metal::float3(0.0), metal::float3(1.0));
    metal::float3 _e354 = c;
    return _e354;
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
    float _e273 = value;
    if (_e273 <= -500.0) {
        metal::float3 _e275 = c0_;
        return _e275;
    }
    float _e276 = value;
    if (_e276 <= 0.0) {
        metal::float3 _e278 = c0_;
        metal::float3 _e279 = c1_;
        float _e280 = value;
        return metal::mix(_e278, _e279, metal::float3((_e280 + 500.0) / 500.0));
    }
    float _e285 = value;
    if (_e285 <= 300.0) {
        metal::float3 _e287 = c1_;
        metal::float3 _e288 = c2_;
        float _e289 = value;
        return metal::mix(_e287, _e288, metal::float3(_e289 / 300.0));
    }
    float _e293 = value;
    if (_e293 <= 900.0) {
        metal::float3 _e295 = c2_;
        metal::float3 _e296 = c3_;
        float _e297 = value;
        return metal::mix(_e295, _e296, metal::float3((_e297 - 300.0) / 600.0));
    }
    float _e302 = value;
    if (_e302 <= 1600.0) {
        metal::float3 _e304 = c3_;
        metal::float3 _e305 = c4_;
        float _e306 = value;
        return metal::mix(_e304, _e305, metal::float3((_e306 - 900.0) / 700.0));
    }
    float _e311 = value;
    if (_e311 <= 2400.0) {
        metal::float3 _e313 = c4_;
        metal::float3 _e314 = c5_;
        float _e315 = value;
        return metal::mix(_e313, _e314, metal::float3((_e315 - 1600.0) / 800.0));
    }
    float _e320 = value;
    if (_e320 <= 3200.0) {
        metal::float3 _e322 = c5_;
        metal::float3 _e323 = c6_;
        float _e324 = value;
        return metal::mix(_e322, _e323, metal::float3((_e324 - 2400.0) / 800.0));
    }
    float _e329 = value;
    if (_e329 <= 6000.0) {
        metal::float3 _e331 = c6_;
        metal::float3 _e332 = c7_;
        float _e333 = value;
        return metal::mix(_e331, _e332, metal::float3((_e333 - 3200.0) / 2800.0));
    }
    metal::float3 _e338 = c7_;
    return _e338;
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
    float _e271 = dx;
    east = _e271;
    float _e272 = dy;
    north = -(_e272);
    float _e275 = unnamed.u_sunAltitude;
    altitude = ((_e275) * 0.017453292519943295474);
    float _e277 = azimuth;
    az = ((_e277) * 0.017453292519943295474);
    float _e279 = east;
    float _e281 = altitude;
    float _e284 = az;
    float _e287 = north;
    float _e288 = altitude;
    float _e291 = az;
    float _e295 = altitude;
    float _e298 = east;
    float _e299 = east;
    float _e301 = north;
    float _e302 = north;
    return metal::clamp(((((-(_e279) * metal::cos(_e281)) * metal::sin(_e284)) - ((_e287 * metal::cos(_e288)) * metal::cos(_e291))) + metal::sin(_e295)) / metal::sqrt(((_e298 * _e299) + (_e301 * _e302)) + 1.0), 0.0, 1.0);
}

metal::float3 cspAspectColour_u0028_f1_u003b(
    thread float& degreesValue
) {
    float sector = {};
    float t = {};
    metal::float3 a = {};
    metal::float3 b = {};
    float _e269 = degreesValue;
    sector = metal::floor(_e269 / 45.0);
    float _e272 = degreesValue;
    t = metal::fract(_e272 / 45.0);
    float _e275 = sector;
    if (_e275 < 1.0) {
        a = metal::float3(77.0, 120.0, 200.0);
        b = metal::float3(59.0, 165.0, 176.0);
    } else {
        float _e277 = sector;
        if (_e277 < 2.0) {
            a = metal::float3(59.0, 165.0, 176.0);
            b = metal::float3(87.0, 167.0, 101.0);
        } else {
            float _e279 = sector;
            if (_e279 < 3.0) {
                a = metal::float3(87.0, 167.0, 101.0);
                b = metal::float3(201.0, 173.0, 79.0);
            } else {
                float _e281 = sector;
                if (_e281 < 4.0) {
                    a = metal::float3(201.0, 173.0, 79.0);
                    b = metal::float3(217.0, 107.0, 82.0);
                } else {
                    float _e283 = sector;
                    if (_e283 < 5.0) {
                        a = metal::float3(217.0, 107.0, 82.0);
                        b = metal::float3(196.0, 91.0, 130.0);
                    } else {
                        float _e285 = sector;
                        if (_e285 < 6.0) {
                            a = metal::float3(196.0, 91.0, 130.0);
                            b = metal::float3(141.0, 101.0, 187.0);
                        } else {
                            float _e287 = sector;
                            if (_e287 < 7.0) {
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
    metal::float3 _e289 = a;
    metal::float3 _e290 = b;
    float _e291 = t;
    return metal::mix(_e289, _e290, metal::float3(_e291)) / metal::float3(255.0);
}

float cspAspectOf_u0028_f1_u003b_f1_u003b(
    thread float& dx_1,
    thread float& dy_1
) {
    float _e266 = dx_1;
    float _e268 = dy_1;
    float _e271 = ((metal::atan2(-(_e266), _e268)) * 57.295779513082322865) + 360.0;
    return _e271 - (metal::floor(_e271 / 360.0) * 360.0);
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
    float _e278 = value_1;
    float _e279 = v1_;
    if (_e278 <= _e279) {
        metal::float3 _e281 = c0_1;
        metal::float3 _e282 = c1_1;
        float _e283 = value_1;
        float _e284 = v1_;
        return metal::mix(_e281, _e282, metal::float3(metal::clamp(_e283 / metal::max(_e284, 0.0001), 0.0, 1.0)));
    }
    float _e290 = value_1;
    float _e291 = v2_;
    if (_e290 <= _e291) {
        metal::float3 _e293 = c1_1;
        metal::float3 _e294 = c2_1;
        float _e295 = value_1;
        float _e296 = v1_;
        float _e298 = v2_;
        float _e299 = v1_;
        return metal::mix(_e293, _e294, metal::float3((_e295 - _e296) / (_e298 - _e299)));
    }
    float _e304 = value_1;
    float _e305 = v3_;
    if (_e304 <= _e305) {
        metal::float3 _e307 = c2_1;
        metal::float3 _e308 = c3_1;
        float _e309 = value_1;
        float _e310 = v2_;
        float _e312 = v3_;
        float _e313 = v2_;
        return metal::mix(_e307, _e308, metal::float3((_e309 - _e310) / (_e312 - _e313)));
    }
    float _e318 = value_1;
    float _e319 = v4_;
    if (_e318 <= _e319) {
        metal::float3 _e321 = c3_1;
        metal::float3 _e322 = c4_1;
        float _e323 = value_1;
        float _e324 = v3_;
        float _e326 = v4_;
        float _e327 = v3_;
        return metal::mix(_e321, _e322, metal::float3((_e323 - _e324) / (_e326 - _e327)));
    }
    float _e332 = value_1;
    float _e333 = v5_;
    if (_e332 <= _e333) {
        metal::float3 _e335 = c4_1;
        metal::float3 _e336 = c5_1;
        float _e337 = value_1;
        float _e338 = v4_;
        float _e340 = v5_;
        float _e341 = v4_;
        return metal::mix(_e335, _e336, metal::float3((_e337 - _e338) / (_e340 - _e341)));
    }
    float _e346 = value_1;
    float _e347 = v6_;
    if (_e346 <= _e347) {
        metal::float3 _e349 = c5_1;
        metal::float3 _e350 = c6_1;
        float _e351 = value_1;
        float _e352 = v5_;
        float _e354 = v6_;
        float _e355 = v5_;
        return metal::mix(_e349, _e350, metal::float3((_e351 - _e352) / (_e354 - _e355)));
    }
    metal::float3 _e360 = c6_1;
    return _e360;
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
    float _e279 = degreesValue_1;
    param = _e279;
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
    metal::float3 _e280 = cspRamp_u0028_f1_u003b_vf3_u003b_f1_u003b_vf3_u003b_f1_u003b_vf3_u003b_f1_u003b_vf3_u003b_f1_u003b_vf3_u003b_f1_u003b_vf3_u003b_f1_u003b_vf3_u003b(param, param_1, param_2, param_3, param_4, param_5, param_6, param_7, param_8, param_9, param_10, param_11, param_12, param_13);
    return _e280;
}

float cspLum_u0028_vf3_u003b(
    thread metal::float3& c_1
) {
    metal::float3 _e265 = c_1;
    return metal::dot(_e265, metal::float3(0.3, 0.59, 0.11));
}

metal::float3 cspClipColour_u0028_vf3_u003b(
    thread metal::float3& c_2
) {
    float l = {};
    metal::float3 param_14 = {};
    float n = {};
    float x = {};
    metal::float3 _e269 = c_2;
    param_14 = _e269;
    float _e270 = cspLum_u0028_vf3_u003b(param_14);
    l = _e270;
    float _e272 = c_2[0u];
    float _e274 = c_2[1u];
    float _e277 = c_2[2u];
    n = metal::min(metal::min(_e272, _e274), _e277);
    float _e280 = c_2[0u];
    float _e282 = c_2[1u];
    float _e285 = c_2[2u];
    x = metal::max(metal::max(_e280, _e282), _e285);
    float _e287 = n;
    if (_e287 < 0.0) {
        float _e289 = l;
        metal::float3 _e290 = c_2;
        float _e291 = l;
        float _e294 = l;
        float _e296 = l;
        float _e297 = n;
        c_2 = metal::float3(_e289) + (((_e290 - metal::float3(_e291)) * _e294) / metal::float3(metal::max(_e296 - _e297, 0.000001)));
    }
    float _e304 = x;
    if (_e304 > 1.0) {
        float _e306 = l;
        metal::float3 _e307 = c_2;
        float _e308 = l;
        float _e311 = l;
        float _e314 = x;
        float _e315 = l;
        c_2 = metal::float3(_e306) + (((_e307 - metal::float3(_e308)) * (1.0 - _e311)) / metal::float3(metal::max(_e314 - _e315, 0.000001)));
    }
    metal::float3 _e322 = c_2;
    return _e322;
}

metal::float3 cspSetLum_u0028_vf3_u003b_f1_u003b(
    thread metal::float3& c_3,
    thread float& l_1
) {
    metal::float3 param_15 = {};
    metal::float3 param_16 = {};
    metal::float3 _e268 = c_3;
    float _e269 = l_1;
    metal::float3 _e270 = c_3;
    param_15 = _e270;
    float _e271 = cspLum_u0028_vf3_u003b(param_15);
    param_16 = _e268 + metal::float3(_e269 - _e271);
    metal::float3 _e275 = cspClipColour_u0028_vf3_u003b(param_16);
    return _e275;
}

metal::float3 cspSoftLight_u0028_vf3_u003b_vf3_u003b(
    thread metal::float3& b_1,
    thread metal::float3& s_1
) {
    metal::float3 d = {};
    metal::float3 _e267 = b_1;
    metal::float3 _e271 = b_1;
    metal::float3 _e275 = b_1;
    metal::float3 _e277 = b_1;
    metal::float3 _e279 = b_1;
    d = metal::mix(((((_e267 * 16.0) - metal::float3(12.0)) * _e271) + metal::float3(4.0)) * _e275, metal::sqrt(_e277), metal::step(metal::float3(0.25), _e279));
    metal::float3 _e283 = b_1;
    metal::float3 _e284 = s_1;
    metal::float3 _e288 = b_1;
    metal::float3 _e290 = b_1;
    metal::float3 _e295 = b_1;
    metal::float3 _e296 = s_1;
    metal::float3 _e300 = d;
    metal::float3 _e301 = b_1;
    metal::float3 _e305 = s_1;
    return metal::mix(_e283 - (((metal::float3(1.0) - (_e284 * 2.0)) * _e288) * (metal::float3(1.0) - _e290)), _e295 + (((_e296 * 2.0) - metal::float3(1.0)) * (_e300 - _e301)), metal::step(metal::float3(0.5), _e305));
}

metal::float3 cspHardLight_u0028_vf3_u003b_vf3_u003b(
    thread metal::float3& b_2,
    thread metal::float3& s_2
) {
    metal::float3 _e266 = b_2;
    metal::float3 _e268 = s_2;
    metal::float3 _e270 = b_2;
    metal::float3 _e273 = s_2;
    metal::float3 _e282 = s_2;
    return metal::mix((_e266 * 2.0) * _e268, metal::float3(1.0) - ((metal::float3(1.0) - _e270) * (metal::float3(1.0) - ((_e273 * 2.0) - metal::float3(1.0)))), metal::step(metal::float3(0.5), _e282));
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
    int _e279 = mode;
    if (_e279 == 1) {
        metal::float3 _e281 = b_3;
        metal::float3 _e282 = s_3;
        return _e281 * _e282;
    }
    int _e284 = mode;
    if (_e284 == 2) {
        metal::float3 _e286 = b_3;
        metal::float3 _e287 = s_3;
        metal::float3 _e289 = b_3;
        metal::float3 _e290 = s_3;
        return (_e286 + _e287) - (_e289 * _e290);
    }
    int _e293 = mode;
    if (_e293 == 3) {
        metal::float3 _e295 = s_3;
        param_17 = _e295;
        metal::float3 _e296 = b_3;
        param_18 = _e296;
        metal::float3 _e297 = cspHardLight_u0028_vf3_u003b_vf3_u003b(param_17, param_18);
        return _e297;
    }
    int _e298 = mode;
    if (_e298 == 4) {
        metal::float3 _e300 = b_3;
        param_19 = _e300;
        metal::float3 _e301 = s_3;
        param_20 = _e301;
        metal::float3 _e302 = cspSoftLight_u0028_vf3_u003b_vf3_u003b(param_19, param_20);
        return _e302;
    }
    int _e303 = mode;
    if (_e303 == 5) {
        metal::float3 _e305 = b_3;
        param_21 = _e305;
        metal::float3 _e306 = s_3;
        param_22 = _e306;
        metal::float3 _e307 = cspHardLight_u0028_vf3_u003b_vf3_u003b(param_21, param_22);
        return _e307;
    }
    int _e308 = mode;
    if (_e308 == 6) {
        metal::float3 _e310 = b_3;
        metal::float3 _e311 = s_3;
        return metal::min(_e310, _e311);
    }
    int _e313 = mode;
    if (_e313 == 7) {
        metal::float3 _e315 = b_3;
        metal::float3 _e316 = s_3;
        return metal::max(_e315, _e316);
    }
    int _e318 = mode;
    if (_e318 == 8) {
        metal::float3 _e320 = b_3;
        param_23 = _e320;
        float _e321 = cspLum_u0028_vf3_u003b(param_23);
        metal::float3 _e322 = s_3;
        param_24 = _e322;
        param_25 = _e321;
        metal::float3 _e323 = cspSetLum_u0028_vf3_u003b_f1_u003b(param_24, param_25);
        return _e323;
    }
    int _e324 = mode;
    if (_e324 == 9) {
        metal::float3 _e326 = s_3;
        param_26 = _e326;
        float _e327 = cspLum_u0028_vf3_u003b(param_26);
        metal::float3 _e328 = b_3;
        param_27 = _e328;
        param_28 = _e327;
        metal::float3 _e329 = cspSetLum_u0028_vf3_u003b_f1_u003b(param_27, param_28);
        return _e329;
    }
    metal::float3 _e330 = s_3;
    return _e330;
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
    float _e276 = backdrop[3u];
    ab = _e276;
    float _e277 = ab;
    if (_e277 > 0.0) {
        metal::float4 _e279 = backdrop;
        float _e281 = ab;
        local = _e279.xyz / metal::float3(_e281);
    } else {
        local = metal::float3(0.0, 0.0, 0.0);
    }
    metal::float3 _e284 = local;
    b_4 = _e284;
    float _e285 = ab;
    metal::float3 _e287 = s_4;
    float _e289 = ab;
    int _e290 = mode_1;
    param_29 = _e290;
    metal::float3 _e291 = b_4;
    param_30 = _e291;
    metal::float3 _e292 = s_4;
    param_31 = _e292;
    metal::float3 _e293 = cspBlendMode_u0028_i1_u003b_vf3_u003b_vf3_u003b(param_29, param_30, param_31);
    mixed = (_e287 * (1.0 - _e285)) + (metal::clamp(_e293, metal::float3(0.0), metal::float3(1.0)) * _e289);
    float _e299 = as;
    metal::float3 _e300 = mixed;
    float _e302 = as;
    metal::float4 _e304 = backdrop;
    metal::float3 _e307 = (_e300 * _e299) + (_e304.xyz * (1.0 - _e302));
    float _e308 = as;
    float _e309 = ab;
    float _e310 = as;
    return metal::float4(_e307.x, _e307.y, _e307.z, _e308 + (_e309 * (1.0 - _e310)));
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
    int _e271 = layer;
    int _e273 = k;
    metal::float4 _e278 = unnamed.u_layerPos.inner[as_type<int>(as_type<uint>(as_type<int>(as_type<uint>(_e271) * as_type<uint>(3))) + as_type<uint>(naga_div(_e273, 4)))];
    v = _e278;
    int _e279 = k;
    int _e280 = k;
    m = as_type<int>(as_type<uint>(_e279) - as_type<uint>(as_type<int>(as_type<uint>(naga_div(_e280, 4)) * as_type<uint>(4))));
    int _e284 = m;
    if (_e284 == 0) {
        float _e287 = v[0u];
        local_1 = _e287;
    } else {
        int _e288 = m;
        if (_e288 == 1) {
            float _e291 = v[1u];
            local_2 = _e291;
        } else {
            int _e292 = m;
            if (_e292 == 2) {
                float _e295 = v[2u];
                local_3 = _e295;
            } else {
                float _e297 = v[3u];
                local_3 = _e297;
            }
            float _e298 = local_3;
            local_2 = _e298;
        }
        float _e299 = local_2;
        local_1 = _e299;
    }
    float _e300 = local_1;
    return _e300;
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
    bool phi_1586_ = {};
    int _e277 = layer_1;
    float _e281 = unnamed.u_layerA.inner[_e277][3u];
    count = naga_f2i32(_e281 + 0.5);
    int _e284 = layer_1;
    base = as_type<int>(as_type<uint>(_e284) * as_type<uint>(10));
    int _e286 = count;
    bool _e287 = _e286 <= 1;
    phi_1586_ = _e287;
    if (!(_e287)) {
        float _e289 = t_1;
        int _e290 = layer_1;
        param_32 = _e290;
        param_33 = 0;
        float _e291 = cspStopPos_u0028_i1_u003b_i1_u003b(param_32, param_33, unnamed);
        phi_1586_ = _e289 <= _e291;
    }
    bool _e294 = phi_1586_;
    if (_e294) {
        int _e295 = base;
        metal::float4 _e298 = unnamed.u_layerColors.inner[_e295];
        return _e298;
    }
    k_1 = 1;
    uint2 loop_bound = uint2(4294967295u);
    bool loop_init = true;
    while(true) {
        if (metal::all(loop_bound == uint2(0u))) { break; }
        loop_bound -= uint2(loop_bound.y == 0u, 1u);
        if (!loop_init) {
            int _e338 = k_1;
            k_1 = as_type<int>(as_type<uint>(_e338) + as_type<uint>(1));
        }
        loop_init = false;
        int _e299 = k_1;
        if (_e299 < 10) {
            int _e301 = k_1;
            int _e302 = count;
            if (_e301 >= _e302) {
                break;
            }
            int _e304 = layer_1;
            param_34 = _e304;
            int _e305 = k_1;
            param_35 = _e305;
            float _e306 = cspStopPos_u0028_i1_u003b_i1_u003b(param_34, param_35, unnamed);
            p1_ = _e306;
            float _e307 = t_1;
            float _e308 = p1_;
            if (_e307 <= _e308) {
                int _e310 = k_1;
                int _e312 = layer_1;
                param_36 = _e312;
                param_37 = as_type<int>(as_type<uint>(_e310) - as_type<uint>(1));
                float _e313 = cspStopPos_u0028_i1_u003b_i1_u003b(param_36, param_37, unnamed);
                p0_ = _e313;
                int _e314 = base;
                int _e315 = k_1;
                metal::float4 _e320 = unnamed.u_layerColors.inner[as_type<int>(as_type<uint>(as_type<int>(as_type<uint>(_e314) + as_type<uint>(_e315))) - as_type<uint>(1))];
                int _e321 = base;
                int _e322 = k_1;
                metal::float4 _e326 = unnamed.u_layerColors.inner[as_type<int>(as_type<uint>(_e321) + as_type<uint>(_e322))];
                float _e327 = t_1;
                float _e328 = p0_;
                float _e330 = p1_;
                float _e331 = p0_;
                return metal::mix(_e320, _e326, metal::float4(metal::clamp((_e327 - _e328) / metal::max(_e330 - _e331, 0.000001), 0.0, 1.0)));
            }
            continue;
        } else {
            break;
        }
    }
    int _e340 = base;
    int _e341 = count;
    metal::float4 _e346 = unnamed.u_layerColors.inner[as_type<int>(as_type<uint>(as_type<int>(as_type<uint>(_e340) + as_type<uint>(_e341))) - as_type<uint>(1))];
    return _e346;
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
    int _e271 = layer_2;
    metal::float4 _e274 = unnamed.u_layerB.inner[_e271];
    r = _e274;
    float _e275 = value_2;
    float _e277 = range[0u];
    float _e280 = range[1u];
    float _e282 = range[0u];
    t_2 = metal::clamp((_e275 - _e277) / metal::max(_e280 - _e282, 0.000001), 0.0, 1.0);
    float _e287 = t_2;
    float _e290 = r[2u];
    t_2 = metal::pow(metal::max(_e287, 0.0), _e290);
    float _e293 = r[3u];
    if (_e293 >= 2.0) {
        float _e295 = t_2;
        float _e297 = r[3u];
        float _e301 = r[3u];
        float _e305 = r[3u];
        t_2 = metal::min(metal::floor(_e295 * _e297), _e301 - 1.0) / (_e305 - 1.0);
    }
    int _e308 = layer_2;
    param_38 = _e308;
    float _e309 = t_2;
    param_39 = _e309;
    metal::float4 _e310 = cspRampAt_u0028_i1_u003b_f1_u003b(param_38, param_39, unnamed);
    return _e310;
}

metal::float4 cspPalette_u0028_i1_u003b_f1_u003b(
    thread int& layer_3,
    thread float& value_3,
    constant CskUniforms& unnamed
) {
    int param_40 = {};
    float param_41 = {};
    metal::float2 param_42 = {};
    int _e269 = layer_3;
    int _e270 = layer_3;
    param_40 = _e270;
    float _e271 = value_3;
    param_41 = _e271;
    metal::float4 _e274 = unnamed.u_layerB.inner[_e269];
    param_42 = _e274.xy;
    metal::float4 _e276 = cspPaletteRange_u0028_i1_u003b_f1_u003b_vf2_u003b(param_40, param_41, param_42, unnamed);
    return _e276;
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
    float _e275 = value_4;
    float _e277 = range_1[0u];
    float _e280 = range_1[1u];
    float _e282 = range_1[0u];
    t_3 = metal::clamp((_e275 - _e277) / metal::max(0.000001, _e280 - _e282), 0.0, 1.0);
    int _e287 = layer_4;
    metal::float4 _e290 = unnamed.u_layerB.inner[_e287];
    r_1 = _e290;
    float _e291 = t_3;
    float _e294 = r_1[2u];
    t_3 = metal::pow(metal::max(_e291, 0.0), _e294);
    float _e297 = r_1[3u];
    if (_e297 >= 2.0) {
        float _e299 = t_3;
        float _e301 = r_1[3u];
        float _e305 = r_1[3u];
        float _e309 = r_1[3u];
        t_3 = metal::min(metal::floor(_e299 * _e301), _e305 - 1.0) / (_e309 - 1.0);
    }
    deep = metal::float3(0.011764706, 0.015686275, 0.36862746);
    mid = metal::float3(0.0, 0.46666667, 0.7137255);
    shallow = metal::float3(0.5647059, 0.8784314, 0.9372549);
    float _e312 = t_3;
    if (_e312 < 0.5) {
        metal::float3 _e314 = deep;
        metal::float3 _e315 = mid;
        float _e316 = t_3;
        local_4 = metal::mix(_e314, _e315, metal::float3(_e316 * 2.0));
    } else {
        metal::float3 _e320 = mid;
        metal::float3 _e321 = shallow;
        float _e322 = t_3;
        local_4 = metal::mix(_e320, _e321, metal::float3((_e322 - 0.5) * 2.0));
    }
    metal::float3 _e327 = local_4;
    int _e328 = layer_4;
    param_43 = _e328;
    float _e329 = t_3;
    param_44 = _e329;
    metal::float4 _e330 = cspRampAt_u0028_i1_u003b_f1_u003b(param_43, param_44, unnamed);
    return metal::float4(_e327.x, _e327.y, _e327.z, _e330.w);
}

uint cspWaterClass_u0028_vf2_u003b(
    thread metal::float2& merc,
    metal::texture2d<uint, metal::access::sample> u_waterMask
) {
    float latitude = {};
    metal::int2 q = {};
    metal::uint4 packed = {};
    float _e269 = merc[1u];
    latitude = ((metal::atan(metal::sinh(3.1415927 * (1.0 - (2.0 * _e269))))) * 57.295779513082322865);
    float _e277 = merc[0u];
    float _e283 = latitude;
    q = metal::int2(naga_f2i32(metal::min(16383.0, metal::floor(metal::fract(_e277) * 16384.0))), naga_f2i32(metal::clamp(metal::floor(((90.0 - _e283) / 180.0) * 8192.0), 0.0, 8191.0)));
    int _e292 = q[0u];
    int _e295 = q[1u];
    metal::uint4 _e298 = u_waterMask.read(metal::uint2(metal::int2(naga_div(_e292, 8), naga_div(_e295, 4))), 0);
    packed = _e298;
    int _e300 = q[1u];
    uint _e309 = packed[as_type<int>(as_type<uint>(_e300) - as_type<uint>(as_type<int>(as_type<uint>(naga_f2i32(metal::floor(static_cast<float>(_e300) / static_cast<float>(4)))) * as_type<uint>(4))))];
    int _e311 = q[0u];
    return (_e309 >> as_type<uint>(as_type<uint>(as_type<int>(as_type<uint>(14) - as_type<uint>(as_type<int>(as_type<uint>(2) * as_type<uint>(as_type<int>(as_type<uint>(_e311) - as_type<uint>(as_type<int>(as_type<uint>(naga_f2i32(metal::floor(static_cast<float>(_e311) / static_cast<float>(8)))) * as_type<uint>(8))))))))))) & 3u;
}

metal::float2 cspCustom32_u0028_struct_u002d_CspCtx_u002d_vi2_u002d_f1_u002d_f1_u002d_f1_u002d_f1_u002d_f1_u002d_f1_u002d_f1_u002d_f1_u002d_f11_u003b(
    thread CspCtx& c_4
) {
    float _e266 = c_4.height;
    float _e273 = c_4.height;
    float _e275 = c_4.height;
    return metal::float2((_e266 - (metal::floor(_e266 / 17.0) * 17.0)) / 17.0, (_e273 == _e275) ? 1.0 : 0.0);
}

metal::float2 cspCustomStyle_u0028_i1_u003b_struct_u002d_CspCtx_u002d_vi2_u002d_f1_u002d_f1_u002d_f1_u002d_f1_u002d_f1_u002d_f1_u002d_f1_u002d_f1_u002d_f11_u003b(
    thread int& style,
    thread CspCtx& c_5
) {
    CspCtx param_45 = {};
    int _e267 = style;
    if (_e267 == 32) {
        CspCtx _e269 = c_5;
        param_45 = _e269;
        metal::float2 _e270 = cspCustom32_u0028_struct_u002d_CspCtx_u002d_vi2_u002d_f1_u002d_f1_u002d_f1_u002d_f1_u002d_f1_u002d_f1_u002d_f1_u002d_f1_u002d_f11_u003b(param_45);
        CspCtx _e271 = param_45;
        c_5 = _e271;
        return _e270;
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
    float _e279 = dx_2;
    param_46 = _e279;
    float _e280 = dy_2;
    param_47 = _e280;
    float _e281 = cspAspectOf_u0028_f1_u003b_f1_u003b(param_46, param_47);
    aspect = _e281;
    sum = 0.0;
    total = 0.0;
    index = 0;
    uint2 loop_bound_1 = uint2(4294967295u);
    bool loop_init_1 = true;
    while(true) {
        if (metal::all(loop_bound_1 == uint2(0u))) { break; }
        loop_bound_1 -= uint2(loop_bound_1.y == 0u, 1u);
        if (!loop_init_1) {
            int _e320 = index;
            index = as_type<int>(as_type<uint>(_e320) + as_type<uint>(1));
        }
        loop_init_1 = false;
        int _e282 = index;
        if (_e282 < 4) {
            float _e285 = unnamed.u_sunAzimuth;
            int _e287 = index;
            az_1 = (_e285 - 90.0) + (45.0 * static_cast<float>(_e287));
            float _e291 = aspect;
            float _e292 = az_1;
            s_5 = metal::sin((((_e291 - (_e292 - (metal::floor(_e292 / 360.0) * 360.0)))) * 0.017453292519943295474));
            float _e300 = dx_2;
            float _e301 = dy_2;
            if (metal::length(metal::float2(_e300, _e301)) < 0.000000000001) {
                local_5 = 1.0;
            } else {
                float _e305 = s_5;
                float _e306 = s_5;
                local_5 = _e305 * _e306;
            }
            float _e308 = local_5;
            weight = _e308;
            float _e309 = weight;
            float _e310 = dx_2;
            param_48 = _e310;
            float _e311 = dy_2;
            param_49 = _e311;
            float _e312 = az_1;
            param_50 = _e312;
            float _e313 = cspDirectShade_u0028_f1_u003b_f1_u003b_f1_u003b(param_48, param_49, param_50, unnamed);
            float _e315 = sum;
            sum = _e315 + (_e309 * _e313);
            float _e317 = weight;
            float _e318 = total;
            total = _e318 + _e317;
            continue;
        } else {
            break;
        }
    }
    float _e323 = unnamed.u_ambient;
    float _e325 = unnamed.u_ambient;
    float _e327 = sum;
    float _e329 = total;
    return _e323 + (((1.0 - _e325) * _e327) / metal::max(_e329, 0.00001));
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
    float _e271 = unnamed.u_ambient;
    float _e273 = unnamed.u_ambient;
    float _e275 = dx_3;
    param_51 = _e275;
    float _e276 = dy_3;
    param_52 = _e276;
    float _e277 = azimuth_1;
    param_53 = _e277;
    float _e278 = cspDirectShade_u0028_f1_u003b_f1_u003b_f1_u003b(param_51, param_52, param_53, unnamed);
    return _e271 + ((1.0 - _e273) * _e278);
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
    int _e287 = style_1;
    if (_e287 == 0) {
        float _e290 = c_6.sdx;
        param_55 = _e290;
        float _e292 = c_6.sdy;
        param_56 = _e292;
        float _e294 = unnamed.u_sunAzimuth;
        param_57 = _e294;
        float _e295 = cspShadeAt_u0028_f1_u003b_f1_u003b_f1_u003b(param_55, param_56, param_57, unnamed);
        return metal::float2(_e295, 1.0);
    }
    int _e297 = style_1;
    if (_e297 == 1) {
        float _e300 = c_6.sdx;
        param_58 = _e300;
        float _e302 = c_6.sdy;
        param_59 = _e302;
        float _e303 = cspMultiShade_u0028_f1_u003b_f1_u003b(param_58, param_59, unnamed);
        return metal::float2(_e303, 1.0);
    }
    int _e305 = style_1;
    if (_e305 == 2) {
        float _e308 = c_6.slope;
        return metal::float2(_e308, 1.0);
    }
    int _e310 = style_1;
    if (_e310 == 3) {
        float _e313 = c_6.aspect;
        if (_e313 < 0.0) {
            local_6 = metal::float2(0.0, 0.0);
        } else {
            float _e316 = c_6.aspect;
            local_6 = metal::float2(_e316, 1.0);
        }
        metal::float2 _e318 = local_6;
        return _e318;
    }
    int _e319 = style_1;
    if (_e319 == 4) {
        float _e322 = c_6.aspect;
        if (_e322 < 0.0) {
            local_7 = metal::float2(0.0, 0.0);
        } else {
            float _e325 = c_6.aspect;
            local_7 = metal::float2(metal::cos(((_e325) * 0.017453292519943295474)), 1.0);
        }
        metal::float2 _e329 = local_7;
        return _e329;
    }
    int _e330 = style_1;
    if (_e330 == 5) {
        float _e333 = c_6.height;
        return metal::float2(_e333, 1.0);
    }
    int _e335 = style_1;
    if (_e335 == 10) {
        float _e338 = c_6.height;
        float _e340 = c_6.base;
        return metal::float2(metal::max(0.0, _e338 - _e340), 1.0);
    }
    int _e344 = style_1;
    int _e346 = style_1;
    int _e349 = style_1;
    if (((_e344 >= 6) && (_e346 <= 9)) || (_e349 == 11)) {
        int _e352 = style_1;
        if (_e352 == 6) {
            local_8 = 2.0;
        } else {
            int _e354 = style_1;
            if (_e354 == 7) {
                local_9 = 5.0;
            } else {
                int _e356 = style_1;
                if (_e356 == 8) {
                    local_10 = 10.0;
                } else {
                    int _e358 = style_1;
                    if (_e358 == 9) {
                        local_11 = 25.0;
                    } else {
                        float _e360 = param_54;
                        local_11 = metal::max(0.5, _e360);
                    }
                    float _e362 = local_11;
                    local_10 = _e362;
                }
                float _e363 = local_10;
                local_9 = _e363;
            }
            float _e364 = local_9;
            local_8 = _e364;
        }
        float _e365 = local_8;
        interval = _e365;
        float _e367 = c_6.dx;
        float _e369 = c_6.dy;
        float _e373 = c_6.res;
        perPixel = (metal::length(metal::float2(_e367, _e369)) * _e373) * 3.28084;
        float _e376 = perPixel;
        if (_e376 > 0.0) {
            float _e378 = interval;
            float _e379 = perPixel;
            spacing = _e378 / _e379;
            float _e381 = spacing;
            if (_e381 < 3.0) {
                float _e383 = spacing;
                if ((_e383 * 5.0) >= 3.0) {
                    float _e386 = interval;
                    interval = _e386 * 5.0;
                } else {
                    return metal::float2(0.0, 0.0);
                }
            }
        }
        float _e389 = c_6.height;
        float _e391 = interval;
        multiple = (_e389 * 3.28084) / _e391;
        float _e393 = multiple;
        float _e394 = multiple;
        float _e398 = interval;
        distanceToLine = metal::abs(_e393 - metal::rint(_e394)) * _e398;
        float _e400 = interval;
        float _e402 = perPixel;
        lineWidth = metal::max(0.35, metal::min(_e400 * 0.5, _e402 * 0.7));
        float _e406 = distanceToLine;
        float _e407 = lineWidth;
        if (_e406 >= _e407) {
            return metal::float2(0.0, 0.0);
        }
        float _e409 = multiple;
        float _e410 = metal::rint(_e409);
        indexLine = metal::abs(_e410 - (metal::floor(_e410 / 5.0) * 5.0)) < 0.5;
        bool _e417 = indexLine;
        return metal::float2(_e417 ? 1.0 : 0.0, 1.0);
    }
    int _e420 = style_1;
    if (_e420 >= 32) {
        int _e422 = style_1;
        param_60 = _e422;
        CspCtx _e423 = c_6;
        param_61 = _e423;
        metal::float2 _e424 = cspCustomStyle_u0028_i1_u003b_struct_u002d_CspCtx_u002d_vi2_u002d_f1_u002d_f1_u002d_f1_u002d_f1_u002d_f1_u002d_f1_u002d_f1_u002d_f1_u002d_f11_u003b(param_60, param_61);
        CspCtx _e425 = param_61;
        c_6 = _e425;
        return _e424;
    }
    return metal::float2(0.0, 0.0);
}

metal::int2 naga_f2i32(metal::float2 value) {
    return static_cast<metal::int2>(metal::clamp(value, -2147483600.0, 2147483500.0));
}

bool csp_landBase_u0028_vi2_u003b_f1_u003b(
    thread metal::int2& p,
    thread float& v_1,
    constant CskUniforms& unnamed,
    metal::texture2d<float, metal::access::sample> csk_landBase
) {
    metal::float2 q_1 = {};
    metal::int2 b_5 = {};
    metal::float2 fr = {};
    metal::int2 ts = {};
    float sum_1 = {};
    float w = {};
    int y = {};
    int x_1 = {};
    metal::float2 a_1 = {};
    float k_2 = {};
    float local_12 = {};
    float local_13 = {};
    v_1 = 0.0;
    float _e279 = unnamed.csk_landBaseScale;
    if (_e279 <= 0.0) {
        return false;
    }
    metal::float3x3 _e282 = unnamed.csk_auxTransform;
    metal::int2 _e283 = p;
    metal::float2 _e286 = static_cast<metal::float2>(_e283) + metal::float2(0.5);
    float _e293 = unnamed.csk_landBaseScale;
    q_1 = ((_e282 * metal::float3(_e286.x, _e286.y, 1.0)).xy / metal::float2(_e293)) - metal::float2(0.5);
    metal::float2 _e298 = q_1;
    b_5 = naga_f2i32(metal::floor(_e298));
    metal::float2 _e301 = q_1;
    metal::int2 _e302 = b_5;
    fr = _e301 - static_cast<metal::float2>(_e302);
    ts = static_cast<metal::int2>(metal::uint2(csk_landBase.get_width(0), csk_landBase.get_height(0)));
    sum_1 = 0.0;
    w = 0.0;
    y = 0;
    uint2 loop_bound_2 = uint2(4294967295u);
    bool loop_init_2 = true;
    while(true) {
        if (metal::all(loop_bound_2 == uint2(0u))) { break; }
        loop_bound_2 -= uint2(loop_bound_2.y == 0u, 1u);
        if (!loop_init_2) {
            int _e356 = y;
            y = as_type<int>(as_type<uint>(_e356) + as_type<uint>(1));
        }
        loop_init_2 = false;
        int _e307 = y;
        if (_e307 < 2) {
            x_1 = 0;
            uint2 loop_bound_3 = uint2(4294967295u);
            bool loop_init_3 = true;
            while(true) {
                if (metal::all(loop_bound_3 == uint2(0u))) { break; }
                loop_bound_3 -= uint2(loop_bound_3.y == 0u, 1u);
                if (!loop_init_3) {
                    int _e354 = x_1;
                    x_1 = as_type<int>(as_type<uint>(_e354) + as_type<uint>(1));
                }
                loop_init_3 = false;
                int _e309 = x_1;
                if (_e309 < 2) {
                    metal::int2 _e311 = b_5;
                    int _e312 = x_1;
                    int _e313 = y;
                    metal::int2 _e316 = ts;
                    metal::float4 _e320 = csk_landBase.read(metal::uint2(metal::clamp(as_type<metal::int2>(as_type<metal::uint2>(_e311) + as_type<metal::uint2>(metal::int2(_e312, _e313))), metal::int2(0, 0), as_type<metal::int2>(as_type<metal::uint2>(_e316) - as_type<metal::uint2>(metal::int2(1))))), 0);
                    a_1 = _e320.xy;
                    int _e322 = x_1;
                    if (_e322 == 0) {
                        float _e325 = fr[0u];
                        local_12 = 1.0 - _e325;
                    } else {
                        float _e328 = fr[0u];
                        local_12 = _e328;
                    }
                    float _e329 = local_12;
                    int _e330 = y;
                    if (_e330 == 0) {
                        float _e333 = fr[1u];
                        local_13 = 1.0 - _e333;
                    } else {
                        float _e336 = fr[1u];
                        local_13 = _e336;
                    }
                    float _e337 = local_13;
                    k_2 = _e329 * _e337;
                    float _e340 = a_1[1u];
                    float _e342 = k_2;
                    if ((_e340 > 0.0) && (_e342 > 0.0)) {
                        float _e346 = a_1[0u];
                        float _e347 = k_2;
                        float _e349 = sum_1;
                        sum_1 = _e349 + (_e346 * _e347);
                        float _e351 = k_2;
                        float _e352 = w;
                        w = _e352 + _e351;
                    }
                    continue;
                } else {
                    break;
                }
            }
            continue;
        } else {
            break;
        }
    }
    float _e358 = w;
    if (_e358 <= 0.0) {
        return false;
    }
    float _e360 = sum_1;
    float _e361 = w;
    v_1 = _e360 / _e361;
    return true;
}

bool csp_base_u0028_vi2_u003b_f1_u003b(
    thread metal::int2& p_1,
    thread float& v_2,
    constant CskUniforms& unnamed,
    metal::texture2d<float, metal::access::sample> csk_base
) {
    metal::float2 q_2 = {};
    metal::int2 b_6 = {};
    metal::float2 fr_1 = {};
    metal::int2 ts_1 = {};
    float sum_2 = {};
    float w_1 = {};
    int y_1 = {};
    int x_2 = {};
    metal::float2 a_2 = {};
    float k_3 = {};
    float local_14 = {};
    float local_15 = {};
    v_2 = 0.0;
    float _e279 = unnamed.csk_baseScale;
    if (_e279 <= 0.0) {
        return false;
    }
    metal::float3x3 _e282 = unnamed.csk_auxTransform;
    metal::int2 _e283 = p_1;
    metal::float2 _e286 = static_cast<metal::float2>(_e283) + metal::float2(0.5);
    float _e293 = unnamed.csk_baseScale;
    q_2 = ((_e282 * metal::float3(_e286.x, _e286.y, 1.0)).xy / metal::float2(_e293)) - metal::float2(0.5);
    metal::float2 _e298 = q_2;
    b_6 = naga_f2i32(metal::floor(_e298));
    metal::float2 _e301 = q_2;
    metal::int2 _e302 = b_6;
    fr_1 = _e301 - static_cast<metal::float2>(_e302);
    ts_1 = static_cast<metal::int2>(metal::uint2(csk_base.get_width(0), csk_base.get_height(0)));
    sum_2 = 0.0;
    w_1 = 0.0;
    y_1 = 0;
    uint2 loop_bound_4 = uint2(4294967295u);
    bool loop_init_4 = true;
    while(true) {
        if (metal::all(loop_bound_4 == uint2(0u))) { break; }
        loop_bound_4 -= uint2(loop_bound_4.y == 0u, 1u);
        if (!loop_init_4) {
            int _e356 = y_1;
            y_1 = as_type<int>(as_type<uint>(_e356) + as_type<uint>(1));
        }
        loop_init_4 = false;
        int _e307 = y_1;
        if (_e307 < 2) {
            x_2 = 0;
            uint2 loop_bound_5 = uint2(4294967295u);
            bool loop_init_5 = true;
            while(true) {
                if (metal::all(loop_bound_5 == uint2(0u))) { break; }
                loop_bound_5 -= uint2(loop_bound_5.y == 0u, 1u);
                if (!loop_init_5) {
                    int _e354 = x_2;
                    x_2 = as_type<int>(as_type<uint>(_e354) + as_type<uint>(1));
                }
                loop_init_5 = false;
                int _e309 = x_2;
                if (_e309 < 2) {
                    metal::int2 _e311 = b_6;
                    int _e312 = x_2;
                    int _e313 = y_1;
                    metal::int2 _e316 = ts_1;
                    metal::float4 _e320 = csk_base.read(metal::uint2(metal::clamp(as_type<metal::int2>(as_type<metal::uint2>(_e311) + as_type<metal::uint2>(metal::int2(_e312, _e313))), metal::int2(0, 0), as_type<metal::int2>(as_type<metal::uint2>(_e316) - as_type<metal::uint2>(metal::int2(1))))), 0);
                    a_2 = _e320.xy;
                    int _e322 = x_2;
                    if (_e322 == 0) {
                        float _e325 = fr_1[0u];
                        local_14 = 1.0 - _e325;
                    } else {
                        float _e328 = fr_1[0u];
                        local_14 = _e328;
                    }
                    float _e329 = local_14;
                    int _e330 = y_1;
                    if (_e330 == 0) {
                        float _e333 = fr_1[1u];
                        local_15 = 1.0 - _e333;
                    } else {
                        float _e336 = fr_1[1u];
                        local_15 = _e336;
                    }
                    float _e337 = local_15;
                    k_3 = _e329 * _e337;
                    float _e340 = a_2[1u];
                    float _e342 = k_3;
                    if ((_e340 > 0.0) && (_e342 > 0.0)) {
                        float _e346 = a_2[0u];
                        float _e347 = k_3;
                        float _e349 = sum_2;
                        sum_2 = _e349 + (_e346 * _e347);
                        float _e351 = k_3;
                        float _e352 = w_1;
                        w_1 = _e352 + _e351;
                    }
                    continue;
                } else {
                    break;
                }
            }
            continue;
        } else {
            break;
        }
    }
    float _e358 = w_1;
    if (_e358 <= 0.0) {
        return false;
    }
    float _e360 = sum_2;
    float _e361 = w_1;
    v_2 = _e360 / _e361;
    return true;
}

bool csp_blur_u0028_vi2_u003b_f1_u003b(
    thread metal::int2& p_2,
    thread float& v_3,
    constant CskUniforms& unnamed,
    metal::texture2d<float, metal::access::sample> csk_blur
) {
    metal::float2 q_3 = {};
    metal::int2 b_7 = {};
    metal::float2 fr_2 = {};
    metal::int2 ts_2 = {};
    float sum_3 = {};
    float w_2 = {};
    int y_2 = {};
    int x_3 = {};
    metal::float2 a_3 = {};
    float k_4 = {};
    float local_16 = {};
    float local_17 = {};
    v_3 = 0.0;
    float _e279 = unnamed.csk_blurScale;
    if (_e279 <= 0.0) {
        return false;
    }
    metal::float3x3 _e282 = unnamed.csk_auxTransform;
    metal::int2 _e283 = p_2;
    metal::float2 _e286 = static_cast<metal::float2>(_e283) + metal::float2(0.5);
    float _e293 = unnamed.csk_blurScale;
    q_3 = ((_e282 * metal::float3(_e286.x, _e286.y, 1.0)).xy / metal::float2(_e293)) - metal::float2(0.5);
    metal::float2 _e298 = q_3;
    b_7 = naga_f2i32(metal::floor(_e298));
    metal::float2 _e301 = q_3;
    metal::int2 _e302 = b_7;
    fr_2 = _e301 - static_cast<metal::float2>(_e302);
    ts_2 = static_cast<metal::int2>(metal::uint2(csk_blur.get_width(0), csk_blur.get_height(0)));
    sum_3 = 0.0;
    w_2 = 0.0;
    y_2 = 0;
    uint2 loop_bound_6 = uint2(4294967295u);
    bool loop_init_6 = true;
    while(true) {
        if (metal::all(loop_bound_6 == uint2(0u))) { break; }
        loop_bound_6 -= uint2(loop_bound_6.y == 0u, 1u);
        if (!loop_init_6) {
            int _e356 = y_2;
            y_2 = as_type<int>(as_type<uint>(_e356) + as_type<uint>(1));
        }
        loop_init_6 = false;
        int _e307 = y_2;
        if (_e307 < 2) {
            x_3 = 0;
            uint2 loop_bound_7 = uint2(4294967295u);
            bool loop_init_7 = true;
            while(true) {
                if (metal::all(loop_bound_7 == uint2(0u))) { break; }
                loop_bound_7 -= uint2(loop_bound_7.y == 0u, 1u);
                if (!loop_init_7) {
                    int _e354 = x_3;
                    x_3 = as_type<int>(as_type<uint>(_e354) + as_type<uint>(1));
                }
                loop_init_7 = false;
                int _e309 = x_3;
                if (_e309 < 2) {
                    metal::int2 _e311 = b_7;
                    int _e312 = x_3;
                    int _e313 = y_2;
                    metal::int2 _e316 = ts_2;
                    metal::float4 _e320 = csk_blur.read(metal::uint2(metal::clamp(as_type<metal::int2>(as_type<metal::uint2>(_e311) + as_type<metal::uint2>(metal::int2(_e312, _e313))), metal::int2(0, 0), as_type<metal::int2>(as_type<metal::uint2>(_e316) - as_type<metal::uint2>(metal::int2(1))))), 0);
                    a_3 = _e320.xy;
                    int _e322 = x_3;
                    if (_e322 == 0) {
                        float _e325 = fr_2[0u];
                        local_16 = 1.0 - _e325;
                    } else {
                        float _e328 = fr_2[0u];
                        local_16 = _e328;
                    }
                    float _e329 = local_16;
                    int _e330 = y_2;
                    if (_e330 == 0) {
                        float _e333 = fr_2[1u];
                        local_17 = 1.0 - _e333;
                    } else {
                        float _e336 = fr_2[1u];
                        local_17 = _e336;
                    }
                    float _e337 = local_17;
                    k_4 = _e329 * _e337;
                    float _e340 = a_3[1u];
                    float _e342 = k_4;
                    if ((_e340 > 0.0) && (_e342 > 0.0)) {
                        float _e346 = a_3[0u];
                        float _e347 = k_4;
                        float _e349 = sum_3;
                        sum_3 = _e349 + (_e346 * _e347);
                        float _e351 = k_4;
                        float _e352 = w_2;
                        w_2 = _e352 + _e351;
                    }
                    continue;
                } else {
                    break;
                }
            }
            continue;
        } else {
            break;
        }
    }
    float _e358 = w_2;
    if (_e358 <= 0.0) {
        return false;
    }
    float _e360 = sum_3;
    float _e361 = w_2;
    v_3 = _e360 / _e361;
    return true;
}

metal::int2 csp_size_u0028_(
    metal::texture2d<float, metal::access::sample> csk_field
) {
    return static_cast<metal::int2>(metal::uint2(csk_field.get_width(0), csk_field.get_height(0)));
}

float csp_height_u0028_vi2_u003b(
    thread metal::int2& p_3,
    metal::texture2d<float, metal::access::sample> csk_field
) {
    metal::int2 _e265 = p_3;
    metal::int2 _e266 = csp_size_u0028_(csk_field);
    metal::float4 _e270 = csk_field.read(metal::uint2(metal::clamp(_e265, metal::int2(0, 0), as_type<metal::int2>(as_type<metal::uint2>(_e266) - as_type<metal::uint2>(metal::int2(1))))), 0);
    return _e270.x;
}

float cspH_u0028_vi2_u003b(
    thread metal::int2& q_4,
    metal::texture2d<float, metal::access::sample> csk_field,
    constant CskUniforms& unnamed,
    metal::texture2d<float, metal::access::sample> csk_blur
) {
    float h = {};
    metal::int2 param_62 = {};
    float b_8 = {};
    metal::int2 param_63 = {};
    float param_64 = {};
    bool phi_1502_ = {};
    metal::int2 _e270 = q_4;
    param_62 = _e270;
    float _e271 = csp_height_u0028_vi2_u003b(param_62, csk_field);
    h = _e271;
    float _e273 = unnamed.u_detail;
    bool _e274 = _e273 != 0.0;
    phi_1502_ = _e274;
    if (_e274) {
        metal::int2 _e275 = q_4;
        param_63 = _e275;
        bool _e276 = csp_blur_u0028_vi2_u003b_f1_u003b(param_63, param_64, unnamed, csk_blur);
        float _e277 = param_64;
        b_8 = _e277;
        phi_1502_ = _e276;
    }
    bool _e279 = phi_1502_;
    if (_e279) {
        float _e281 = unnamed.u_detail;
        float _e282 = h;
        float _e283 = b_8;
        float _e286 = h;
        h = _e286 + (_e281 * (_e282 - _e283));
    }
    float _e288 = h;
    return _e288;
}

bool csk_isinf_u0028_f1_u003b(
    thread float& v_4
) {
    float _e265 = v_4;
    return (as_type<uint>(_e265) & 2147483647u) == 2139095040u;
}

bool csk_isnan_u0028_f1_u003b(
    thread float& v_5
) {
    float _e265 = v_5;
    return (as_type<uint>(_e265) & 2147483647u) > 2139095040u;
}

bool csk_ok_u0028_f1_u003b(
    thread float& v_6
) {
    float param_65 = {};
    float param_66 = {};
    bool phi_246_ = {};
    float _e267 = v_6;
    param_65 = _e267;
    bool _e268 = csk_isnan_u0028_f1_u003b(param_65);
    bool _e269 = !(_e268);
    phi_246_ = _e269;
    if (_e269) {
        float _e270 = v_6;
        param_66 = _e270;
        bool _e271 = csk_isinf_u0028_f1_u003b(param_66);
        phi_246_ = !(_e271);
    }
    bool _e274 = phi_246_;
    float _e275 = v_6;
    return _e274 && (_e275 > -100000000000000000000.0);
}

bool csp_valid_u0028_vi2_u003b(
    thread metal::int2& p_4,
    metal::texture2d<float, metal::access::sample> csk_field
) {
    metal::int2 param_67 = {};
    float param_68 = {};
    metal::int2 _e267 = p_4;
    param_67 = _e267;
    float _e268 = csp_height_u0028_vi2_u003b(param_67, csk_field);
    param_68 = _e268;
    bool _e269 = csk_ok_u0028_f1_u003b(param_68);
    return _e269;
}

metal::float4 cspStack_u0028_vi2_u003b_f1_u003b_f1_u003b_f1_u003b_f1_u003b_vf2_u003b(
    thread metal::int2& p_5,
    thread float& value_5,
    thread float& groundRes,
    thread float& cosB,
    thread float& sinB,
    thread metal::float2& merc_1,
    metal::texture2d<float, metal::access::sample> csk_field,
    constant CskUniforms& unnamed,
    metal::texture2d<float, metal::access::sample> csk_blur,
    metal::texture2d<float, metal::access::sample> csk_base,
    metal::texture2d<float, metal::access::sample> csk_landBase,
    metal::texture2d<uint, metal::access::sample> u_waterMask
) {
    metal::int2 px = {};
    metal::int2 py = {};
    metal::int2 param_69 = {};
    metal::int2 param_70 = {};
    metal::int2 param_71 = {};
    metal::int2 param_72 = {};
    metal::int2 param_73 = {};
    metal::int2 param_74 = {};
    metal::int2 param_75 = {};
    metal::int2 param_76 = {};
    CspCtx c_7 = {};
    float a_4 = {};
    metal::int2 param_77 = {};
    float b_9 = {};
    metal::int2 param_78 = {};
    float cc = {};
    metal::int2 param_79 = {};
    float d_1 = {};
    metal::int2 param_80 = {};
    float f = {};
    metal::int2 param_81 = {};
    float g = {};
    metal::int2 param_82 = {};
    float q_5 = {};
    metal::int2 param_83 = {};
    float k_5 = {};
    metal::int2 param_84 = {};
    float dxS = {};
    float dyS = {};
    float zFactor = {};
    float local_18 = {};
    float param_85 = {};
    float param_86 = {};
    float legacyBase = {};
    float baseValue = {};
    metal::int2 param_87 = {};
    float param_88 = {};
    float local_19 = {};
    float landBase = {};
    float landBaseValue = {};
    metal::int2 param_89 = {};
    float param_90 = {};
    float local_20 = {};
    metal::float4 acc = {};
    int i = {};
    metal::float4 layer_5 = {};
    int style_2 = {};
    float param_91 = {};
    int flags = {};
    metal::float2 v_7 = {};
    int param_92 = {};
    float param_93 = {};
    CspCtx param_94 = {};
    uint waterClass = {};
    uint local_21 = {};
    metal::float2 param_95 = {};
    metal::float4 colour = {};
    metal::float4 local_22 = {};
    int param_96 = {};
    float param_97 = {};
    metal::float2 param_98 = {};
    metal::float4 local_23 = {};
    int param_99 = {};
    float param_100 = {};
    metal::float2 param_101 = {};
    int param_102 = {};
    float param_103 = {};
    float shade = {};
    float param_104 = {};
    float param_105 = {};
    float param_106 = {};
    float alpha = {};
    metal::float4 param_107 = {};
    metal::float3 param_108 = {};
    float param_109 = {};
    int param_110 = {};
    metal::float3 straight_1 = {};
    metal::float3 param_111 = {};
    bool phi_2536_ = {};
    bool phi_2546_ = {};
    bool phi_2554_ = {};
    bool phi_2562_ = {};
    bool phi_2572_ = {};
    bool phi_2580_ = {};
    bool phi_2590_ = {};
    bool phi_2881_ = {};
    bool phi_2898_ = {};
    bool phi_2921_ = {};
    px = metal::int2(1, 0);
    py = metal::int2(0, 1);
    metal::int2 _e348 = p_5;
    metal::int2 _e349 = px;
    metal::int2 _e351 = py;
    param_69 = as_type<metal::int2>(as_type<metal::uint2>(as_type<metal::int2>(as_type<metal::uint2>(_e348) - as_type<metal::uint2>(_e349))) - as_type<metal::uint2>(_e351));
    bool _e353 = csp_valid_u0028_vi2_u003b(param_69, csk_field);
    phi_2536_ = _e353;
    if (_e353) {
        metal::int2 _e354 = p_5;
        metal::int2 _e355 = py;
        param_70 = as_type<metal::int2>(as_type<metal::uint2>(_e354) - as_type<metal::uint2>(_e355));
        bool _e357 = csp_valid_u0028_vi2_u003b(param_70, csk_field);
        phi_2536_ = _e357;
    }
    bool _e359 = phi_2536_;
    phi_2546_ = _e359;
    if (_e359) {
        metal::int2 _e360 = p_5;
        metal::int2 _e361 = px;
        metal::int2 _e363 = py;
        param_71 = as_type<metal::int2>(as_type<metal::uint2>(as_type<metal::int2>(as_type<metal::uint2>(_e360) + as_type<metal::uint2>(_e361))) - as_type<metal::uint2>(_e363));
        bool _e365 = csp_valid_u0028_vi2_u003b(param_71, csk_field);
        phi_2546_ = _e365;
    }
    bool _e367 = phi_2546_;
    phi_2554_ = _e367;
    if (_e367) {
        metal::int2 _e368 = p_5;
        metal::int2 _e369 = px;
        param_72 = as_type<metal::int2>(as_type<metal::uint2>(_e368) - as_type<metal::uint2>(_e369));
        bool _e371 = csp_valid_u0028_vi2_u003b(param_72, csk_field);
        phi_2554_ = _e371;
    }
    bool _e373 = phi_2554_;
    phi_2562_ = _e373;
    if (_e373) {
        metal::int2 _e374 = p_5;
        metal::int2 _e375 = px;
        param_73 = as_type<metal::int2>(as_type<metal::uint2>(_e374) + as_type<metal::uint2>(_e375));
        bool _e377 = csp_valid_u0028_vi2_u003b(param_73, csk_field);
        phi_2562_ = _e377;
    }
    bool _e379 = phi_2562_;
    phi_2572_ = _e379;
    if (_e379) {
        metal::int2 _e380 = p_5;
        metal::int2 _e381 = px;
        metal::int2 _e383 = py;
        param_74 = as_type<metal::int2>(as_type<metal::uint2>(as_type<metal::int2>(as_type<metal::uint2>(_e380) - as_type<metal::uint2>(_e381))) + as_type<metal::uint2>(_e383));
        bool _e385 = csp_valid_u0028_vi2_u003b(param_74, csk_field);
        phi_2572_ = _e385;
    }
    bool _e387 = phi_2572_;
    phi_2580_ = _e387;
    if (_e387) {
        metal::int2 _e388 = p_5;
        metal::int2 _e389 = py;
        param_75 = as_type<metal::int2>(as_type<metal::uint2>(_e388) + as_type<metal::uint2>(_e389));
        bool _e391 = csp_valid_u0028_vi2_u003b(param_75, csk_field);
        phi_2580_ = _e391;
    }
    bool _e393 = phi_2580_;
    phi_2590_ = _e393;
    if (_e393) {
        metal::int2 _e394 = p_5;
        metal::int2 _e395 = px;
        metal::int2 _e397 = py;
        param_76 = as_type<metal::int2>(as_type<metal::uint2>(as_type<metal::int2>(as_type<metal::uint2>(_e394) + as_type<metal::uint2>(_e395))) + as_type<metal::uint2>(_e397));
        bool _e399 = csp_valid_u0028_vi2_u003b(param_76, csk_field);
        phi_2590_ = _e399;
    }
    bool _e401 = phi_2590_;
    if (!(_e401)) {
        return metal::float4(0.0, 0.0, 0.0, 0.0);
    }
    metal::int2 _e403 = p_5;
    c_7.p = _e403;
    float _e405 = value_5;
    c_7.height = _e405;
    float _e407 = groundRes;
    c_7.res = _e407;
    c_7.dx = 0.0;
    c_7.dy = 0.0;
    c_7.sdx = 0.0;
    c_7.sdy = 0.0;
    c_7.slope = 0.0;
    c_7.aspect = -1.0;
    float _e416 = unnamed.u_stackGradient;
    if (_e416 > 0.5) {
        metal::int2 _e418 = p_5;
        metal::int2 _e419 = px;
        metal::int2 _e421 = py;
        param_77 = as_type<metal::int2>(as_type<metal::uint2>(as_type<metal::int2>(as_type<metal::uint2>(_e418) - as_type<metal::uint2>(_e419))) - as_type<metal::uint2>(_e421));
        float _e423 = cspH_u0028_vi2_u003b(param_77, csk_field, unnamed, csk_blur);
        a_4 = _e423;
        metal::int2 _e424 = p_5;
        metal::int2 _e425 = py;
        param_78 = as_type<metal::int2>(as_type<metal::uint2>(_e424) - as_type<metal::uint2>(_e425));
        float _e427 = cspH_u0028_vi2_u003b(param_78, csk_field, unnamed, csk_blur);
        b_9 = _e427;
        metal::int2 _e428 = p_5;
        metal::int2 _e429 = px;
        metal::int2 _e431 = py;
        param_79 = as_type<metal::int2>(as_type<metal::uint2>(as_type<metal::int2>(as_type<metal::uint2>(_e428) + as_type<metal::uint2>(_e429))) - as_type<metal::uint2>(_e431));
        float _e433 = cspH_u0028_vi2_u003b(param_79, csk_field, unnamed, csk_blur);
        cc = _e433;
        metal::int2 _e434 = p_5;
        metal::int2 _e435 = px;
        param_80 = as_type<metal::int2>(as_type<metal::uint2>(_e434) - as_type<metal::uint2>(_e435));
        float _e437 = cspH_u0028_vi2_u003b(param_80, csk_field, unnamed, csk_blur);
        d_1 = _e437;
        metal::int2 _e438 = p_5;
        metal::int2 _e439 = px;
        param_81 = as_type<metal::int2>(as_type<metal::uint2>(_e438) + as_type<metal::uint2>(_e439));
        float _e441 = cspH_u0028_vi2_u003b(param_81, csk_field, unnamed, csk_blur);
        f = _e441;
        metal::int2 _e442 = p_5;
        metal::int2 _e443 = px;
        metal::int2 _e445 = py;
        param_82 = as_type<metal::int2>(as_type<metal::uint2>(as_type<metal::int2>(as_type<metal::uint2>(_e442) - as_type<metal::uint2>(_e443))) + as_type<metal::uint2>(_e445));
        float _e447 = cspH_u0028_vi2_u003b(param_82, csk_field, unnamed, csk_blur);
        g = _e447;
        metal::int2 _e448 = p_5;
        metal::int2 _e449 = py;
        param_83 = as_type<metal::int2>(as_type<metal::uint2>(_e448) + as_type<metal::uint2>(_e449));
        float _e451 = cspH_u0028_vi2_u003b(param_83, csk_field, unnamed, csk_blur);
        q_5 = _e451;
        metal::int2 _e452 = p_5;
        metal::int2 _e453 = px;
        metal::int2 _e455 = py;
        param_84 = as_type<metal::int2>(as_type<metal::uint2>(as_type<metal::int2>(as_type<metal::uint2>(_e452) + as_type<metal::uint2>(_e453))) + as_type<metal::uint2>(_e455));
        float _e457 = cspH_u0028_vi2_u003b(param_84, csk_field, unnamed, csk_blur);
        k_5 = _e457;
        float _e458 = cc;
        float _e459 = f;
        float _e462 = k_5;
        float _e464 = a_4;
        float _e465 = d_1;
        float _e468 = g;
        float _e471 = groundRes;
        dxS = (((_e458 + (2.0 * _e459)) + _e462) - ((_e464 + (2.0 * _e465)) + _e468)) / (8.0 * _e471);
        float _e474 = g;
        float _e475 = q_5;
        float _e478 = k_5;
        float _e480 = a_4;
        float _e481 = b_9;
        float _e484 = cc;
        float _e487 = groundRes;
        dyS = (((_e474 + (2.0 * _e475)) + _e478) - ((_e480 + (2.0 * _e481)) + _e484)) / (8.0 * _e487);
        float _e490 = dxS;
        float _e491 = cosB;
        float _e493 = dyS;
        float _e494 = sinB;
        c_7.dx = (_e490 * _e491) + (_e493 * _e494);
        float _e498 = dxS;
        float _e499 = sinB;
        float _e501 = dyS;
        float _e502 = cosB;
        c_7.dy = -(((_e498 * _e499) - (_e501 * _e502)));
        float _e507 = groundRes;
        zFactor = 1.0 + (0.024 * metal::pow(metal::max(_e507, 0.0), 0.664));
        float _e513 = c_7.dx;
        float _e514 = zFactor;
        float _e517 = unnamed.u_reliefExag;
        c_7.sdx = (_e513 * _e514) * _e517;
        float _e521 = c_7.dy;
        float _e522 = zFactor;
        float _e525 = unnamed.u_reliefExag;
        c_7.sdy = (_e521 * _e522) * _e525;
        float _e529 = c_7.dx;
        float _e531 = c_7.dy;
        c_7.slope = ((metal::atan(metal::length(metal::float2(_e529, _e531)))) * 57.295779513082322865);
        float _e538 = c_7.dx;
        float _e540 = c_7.dy;
        if (metal::length(metal::float2(_e538, _e540)) <= 0.008726868) {
            local_18 = -1.0;
        } else {
            float _e545 = c_7.dx;
            param_85 = _e545;
            float _e547 = c_7.dy;
            param_86 = _e547;
            float _e548 = cspAspectOf_u0028_f1_u003b_f1_u003b(param_85, param_86);
            local_18 = _e548;
        }
        float _e549 = local_18;
        c_7.aspect = _e549;
    }
    metal::int2 _e551 = p_5;
    param_87 = _e551;
    bool _e552 = csp_base_u0028_vi2_u003b_f1_u003b(param_87, param_88, unnamed, csk_base);
    float _e553 = param_88;
    baseValue = _e553;
    if (_e552) {
        float _e554 = baseValue;
        local_19 = _e554;
    } else {
        float _e556 = unnamed.u_remFlatBase;
        local_19 = _e556;
    }
    float _e557 = local_19;
    legacyBase = _e557;
    metal::int2 _e558 = p_5;
    param_89 = _e558;
    bool _e559 = csp_landBase_u0028_vi2_u003b_f1_u003b(param_89, param_90, unnamed, csk_landBase);
    float _e560 = param_90;
    landBaseValue = _e560;
    if (_e559) {
        float _e561 = landBaseValue;
        local_20 = _e561;
    } else {
        float _e563 = unnamed.u_remLandBase;
        local_20 = _e563;
    }
    float _e564 = local_20;
    landBase = _e564;
    acc = metal::float4(0.0, 0.0, 0.0, 0.0);
    i = 0;
    uint2 loop_bound_8 = uint2(4294967295u);
    bool loop_init_8 = true;
    while(true) {
        if (metal::all(loop_bound_8 == uint2(0u))) { break; }
        loop_bound_8 -= uint2(loop_bound_8.y == 0u, 1u);
        if (!loop_init_8) {
            int _e716 = i;
            i = as_type<int>(as_type<uint>(_e716) + as_type<uint>(1));
        }
        loop_init_8 = false;
        int _e565 = i;
        if (_e565 < 4) {
            int _e567 = i;
            float _e570 = unnamed.u_layerCount;
            if (static_cast<float>(_e567) >= _e570) {
                break;
            }
            int _e572 = i;
            metal::float4 _e575 = unnamed.u_layerA.inner[_e572];
            layer_5 = _e575;
            float _e577 = layer_5[0u];
            style_2 = naga_f2i32(_e577 + 0.5);
            int _e580 = i;
            float _e584 = unnamed.u_layerC.inner[_e580][0u];
            param_91 = _e584;
            int _e585 = i;
            float _e589 = unnamed.u_layerC.inner[_e585][1u];
            flags = naga_f2i32(_e589 + 0.5);
            int _e592 = flags;
            float _e595 = landBase;
            float _e596 = legacyBase;
            c_7.base = ((_e592 & 2) != 0) ? _e595 : _e596;
            int _e599 = style_2;
            param_92 = _e599;
            float _e600 = param_91;
            param_93 = _e600;
            CspCtx _e601 = c_7;
            param_94 = _e601;
            metal::float2 _e602 = cspLayerValue_u0028_i1_u003b_f1_u003b_struct_u002d_CspCtx_u002d_vi2_u002d_f1_u002d_f1_u002d_f1_u002d_f1_u002d_f1_u002d_f1_u002d_f1_u002d_f1_u002d_f11_u003b(param_92, param_93, param_94, unnamed);
            CspCtx _e603 = param_94;
            c_7 = _e603;
            v_7 = _e602;
            float _e605 = v_7[1u];
            if (_e605 <= 0.0) {
                continue;
            }
            int _e607 = style_2;
            int _e609 = style_2;
            bool _e611 = (_e607 == 5) || (_e609 == 10);
            phi_2881_ = _e611;
            if (_e611) {
                int _e612 = flags;
                phi_2881_ = (_e612 & 5) != 0;
            }
            bool _e616 = phi_2881_;
            if (_e616) {
                metal::float2 _e617 = merc_1;
                param_95 = _e617;
                uint _e618 = cspWaterClass_u0028_vf2_u003b(param_95, u_waterMask);
                local_21 = _e618;
            } else {
                local_21 = 0u;
            }
            uint _e619 = local_21;
            waterClass = _e619;
            uint _e620 = waterClass;
            bool _e621 = _e620 == 1u;
            phi_2898_ = _e621;
            if (_e621) {
                int _e622 = flags;
                phi_2898_ = (_e622 & 1) != 0;
            }
            bool _e626 = phi_2898_;
            if (_e626) {
                int _e627 = i;
                int _e628 = i;
                param_96 = _e628;
                float _e630 = c_7.height;
                param_97 = _e630;
                metal::float4 _e633 = unnamed.u_layerC.inner[_e627];
                param_98 = _e633.zw;
                metal::float4 _e635 = cspWaterColour_u0028_i1_u003b_f1_u003b_vf2_u003b(param_96, param_97, param_98, unnamed);
                local_22 = _e635;
            } else {
                uint _e636 = waterClass;
                bool _e637 = _e636 == 2u;
                phi_2921_ = _e637;
                if (_e637) {
                    int _e638 = flags;
                    phi_2921_ = (_e638 & 4) != 0;
                }
                bool _e642 = phi_2921_;
                if (_e642) {
                    int _e643 = i;
                    int _e644 = i;
                    param_99 = _e644;
                    float _e646 = c_7.height;
                    param_100 = _e646;
                    metal::float4 _e649 = unnamed.u_layerD.inner[_e643];
                    param_101 = _e649.xy;
                    metal::float4 _e651 = cspPaletteRange_u0028_i1_u003b_f1_u003b_vf2_u003b(param_99, param_100, param_101, unnamed);
                    local_23 = _e651;
                } else {
                    int _e652 = i;
                    param_102 = _e652;
                    float _e654 = v_7[0u];
                    param_103 = _e654;
                    metal::float4 _e655 = cspPalette_u0028_i1_u003b_f1_u003b(param_102, param_103, unnamed);
                    local_23 = _e655;
                }
                metal::float4 _e656 = local_23;
                local_22 = _e656;
            }
            metal::float4 _e657 = local_22;
            colour = _e657;
            int _e658 = style_2;
            int _e660 = style_2;
            float _e663 = param_91;
            if (((_e658 == 5) || (_e660 == 10)) && (_e663 > 0.0)) {
                float _e667 = unnamed.u_ambient;
                float _e669 = unnamed.u_ambient;
                float _e672 = c_7.sdx;
                param_104 = _e672;
                float _e674 = c_7.sdy;
                param_105 = _e674;
                float _e676 = unnamed.u_sunAzimuth;
                param_106 = _e676;
                float _e677 = cspDirectShade_u0028_f1_u003b_f1_u003b_f1_u003b(param_104, param_105, param_106, unnamed);
                shade = _e667 + ((1.0 - _e669) * _e677);
                metal::float4 _e680 = colour;
                float _e682 = shade;
                float _e685 = param_91;
                metal::float3 _e689 = metal::min(_e680.xyz * metal::mix(1.0, 0.33 + (0.82 * _e682), metal::clamp(_e685, 0.0, 1.0)), metal::float3(1.0, 1.0, 1.0));
                colour[0u] = _e689.x;
                colour[1u] = _e689.y;
                colour[2u] = _e689.z;
            }
            float _e697 = colour[3u];
            float _e699 = v_7[1u];
            float _e702 = layer_5[1u];
            alpha = metal::clamp((_e697 * _e699) * _e702, 0.0, 1.0);
            float _e705 = alpha;
            if (_e705 <= 0.0) {
                continue;
            }
            float _e708 = layer_5[2u];
            metal::float4 _e711 = acc;
            param_107 = _e711;
            metal::float4 _e712 = colour;
            param_108 = _e712.xyz;
            float _e714 = alpha;
            param_109 = _e714;
            param_110 = naga_f2i32(_e708 + 0.5);
            metal::float4 _e715 = cspComposite_u0028_vf4_u003b_vf3_u003b_f1_u003b_i1_u003b(param_107, param_108, param_109, param_110);
            acc = _e715;
            continue;
        } else {
            break;
        }
    }
    float _e719 = acc[3u];
    if (_e719 <= 0.0) {
        return metal::float4(0.0, 0.0, 0.0, 0.0);
    }
    metal::float4 _e721 = acc;
    float _e724 = acc[3u];
    param_111 = _e721.xyz / metal::float3(_e724);
    metal::float3 _e727 = cspApplyAppearance_u0028_vf3_u003b(param_111, unnamed);
    straight_1 = _e727;
    metal::float3 _e728 = straight_1;
    float _e730 = acc[3u];
    metal::float3 _e731 = _e728 * _e730;
    float _e733 = acc[3u];
    float _e739 = unnamed.u_terrainOpacity;
    return metal::float4(_e731.x, _e731.y, _e731.z, _e733) * _e739;
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
    metal::float3 local_24 = {};
    metal::float3 rgb = {};
    float a_5 = {};
    float belowCoverage = {};
    float local_25 = {};
    float aboveCoverage = {};
    float local_26 = {};
    float a_6 = {};
    float a_7 = {};
    float line = {};
    float a_8 = {};
    result = metal::float4(0.0, 0.0, 0.0, 0.0);
    float _e283 = unnamed.u_spectrumOn;
    if (_e283 > 0.5) {
        float _e285 = value_6;
        float _e287 = unnamed.u_spectrumLevel;
        float _e290 = unnamed.u_spectrumSpan;
        d_2 = (_e285 - _e287) / metal::max(1.0, _e290);
        float _e293 = d_2;
        t_4 = metal::clamp(metal::abs(_e293), 0.0, 1.0);
        float _e296 = t_4;
        float _e297 = t_4;
        float _e299 = t_4;
        blend = (_e296 * _e297) * (3.0 - (2.0 * _e299));
        metal::float3 _e304 = unnamed.u_spectrumMid;
        white = _e304;
        float _e305 = d_2;
        if (_e305 >= 0.0) {
            metal::float3 _e308 = unnamed.u_spectrumHigh;
            local_24 = _e308;
        } else {
            metal::float3 _e310 = unnamed.u_spectrumLow;
            local_24 = _e310;
        }
        metal::float3 _e311 = local_24;
        target = _e311;
        metal::float3 _e312 = white;
        metal::float3 _e313 = target;
        float _e314 = blend;
        rgb = metal::mix(_e312, _e313, metal::float3(_e314));
        float _e318 = unnamed.u_spectrumAlpha;
        float _e319 = t_4;
        a_5 = metal::clamp(_e318 * (0.15 + (0.85 * _e319)), 0.0, 1.0);
        metal::float3 _e324 = rgb;
        float _e325 = a_5;
        metal::float4 _e327 = result;
        float _e329 = a_5;
        metal::float3 _e332 = (_e324 * _e325) + (_e327.xyz * (1.0 - _e329));
        float _e333 = a_5;
        float _e335 = result[3u];
        float _e336 = a_5;
        result = metal::float4(_e332.x, _e332.y, _e332.z, _e333 + (_e335 * (1.0 - _e336)));
    }
    float _e345 = unnamed.u_bandFeather;
    if (_e345 > 0.0) {
        float _e348 = unnamed.u_belowLevel;
        float _e350 = unnamed.u_bandFeather;
        float _e354 = unnamed.u_belowLevel;
        float _e356 = unnamed.u_bandFeather;
        float _e359 = value_6;
        local_25 = 1.0 - metal::smoothstep(_e348 - (_e350 * 0.5), _e354 + (_e356 * 0.5), _e359);
    } else {
        float _e362 = value_6;
        float _e364 = unnamed.u_belowLevel;
        local_25 = metal::step(_e362, _e364);
    }
    float _e366 = local_25;
    belowCoverage = _e366;
    float _e368 = unnamed.u_bandFeather;
    if (_e368 > 0.0) {
        float _e371 = unnamed.u_aboveLevel;
        float _e373 = unnamed.u_bandFeather;
        float _e377 = unnamed.u_aboveLevel;
        float _e379 = unnamed.u_bandFeather;
        float _e382 = value_6;
        local_26 = metal::smoothstep(_e371 - (_e373 * 0.5), _e377 + (_e379 * 0.5), _e382);
    } else {
        float _e385 = unnamed.u_aboveLevel;
        float _e386 = value_6;
        local_26 = metal::step(_e385, _e386);
    }
    float _e388 = local_26;
    aboveCoverage = _e388;
    float _e390 = unnamed.u_belowOn;
    if (_e390 > 0.5) {
        float _e393 = unnamed.u_bandAlpha;
        float _e394 = belowCoverage;
        a_6 = metal::clamp(_e393 * _e394, 0.0, 1.0);
        metal::float3 _e398 = unnamed.u_belowColor;
        float _e399 = a_6;
        metal::float4 _e401 = result;
        float _e403 = a_6;
        metal::float3 _e406 = (_e398 * _e399) + (_e401.xyz * (1.0 - _e403));
        float _e407 = a_6;
        float _e409 = result[3u];
        float _e410 = a_6;
        result = metal::float4(_e406.x, _e406.y, _e406.z, _e407 + (_e409 * (1.0 - _e410)));
    }
    float _e419 = unnamed.u_aboveOn;
    if (_e419 > 0.5) {
        float _e422 = unnamed.u_bandAlpha;
        float _e423 = aboveCoverage;
        a_7 = metal::clamp(_e422 * _e423, 0.0, 1.0);
        metal::float3 _e427 = unnamed.u_aboveColor;
        float _e428 = a_7;
        metal::float4 _e430 = result;
        float _e432 = a_7;
        metal::float3 _e435 = (_e427 * _e428) + (_e430.xyz * (1.0 - _e432));
        float _e436 = a_7;
        float _e438 = result[3u];
        float _e439 = a_7;
        result = metal::float4(_e435.x, _e435.y, _e435.z, _e436 + (_e438 * (1.0 - _e439)));
    }
    float _e448 = unnamed.u_outlineOn;
    if (_e448 > 0.5) {
        line = 0.0;
        float _e451 = unnamed.u_belowOn;
        if (_e451 > 0.5) {
            float _e453 = line;
            float _e455 = unnamed.u_outlineWidth;
            float _e458 = value_6;
            float _e460 = unnamed.u_belowLevel;
            line = metal::max(_e453, 1.0 - metal::smoothstep(0.0, metal::max(0.001, _e455 * 0.5), metal::abs(_e458 - _e460)));
        }
        float _e467 = unnamed.u_aboveOn;
        if (_e467 > 0.5) {
            float _e469 = line;
            float _e471 = unnamed.u_outlineWidth;
            float _e474 = value_6;
            float _e476 = unnamed.u_aboveLevel;
            line = metal::max(_e469, 1.0 - metal::smoothstep(0.0, metal::max(0.001, _e471 * 0.5), metal::abs(_e474 - _e476)));
        }
        float _e482 = line;
        a_8 = metal::clamp(0.88 * _e482, 0.0, 1.0);
        float _e485 = a_8;
        metal::float4 _e487 = result;
        float _e489 = a_8;
        metal::float3 _e492 = (metal::float3(1.0, 1.0, 1.0) * _e485) + (_e487.xyz * (1.0 - _e489));
        float _e493 = a_8;
        float _e495 = result[3u];
        float _e496 = a_8;
        result = metal::float4(_e492.x, _e492.y, _e492.z, _e493 + (_e495 * (1.0 - _e496)));
    }
    metal::float4 _e504 = result;
    return _e504;
}

void main_1(
    metal::texture2d<float, metal::access::sample> csk_field,
    constant CskUniforms& unnamed,
    metal::texture2d<float, metal::access::sample> csk_blur,
    metal::texture2d<float, metal::access::sample> csk_base,
    metal::texture2d<float, metal::access::sample> csk_landBase,
    metal::texture2d<uint, metal::access::sample> u_waterMask,
    thread metal::float2& v_screenUv_1,
    thread metal::float4& fragColor
) {
    metal::int2 size = {};
    metal::int2 p_6 = {};
    metal::int2 param_112 = {};
    float value_7 = {};
    metal::int2 param_113 = {};
    metal::float2 cssOffset = {};
    float cosB_1 = {};
    float sinB_1 = {};
    float worldCss = {};
    metal::float2 merc_2 = {};
    float lat = {};
    float mpp = {};
    float groundRes_1 = {};
    float local_27 = {};
    metal::float4 spectrum = {};
    float param_114 = {};
    metal::float4 terrain = {};
    metal::int2 param_115 = {};
    float param_116 = {};
    float param_117 = {};
    float param_118 = {};
    float param_119 = {};
    metal::float2 param_120 = {};
    metal::int2 px_1 = {};
    metal::int2 py_1 = {};
    bool allValid = {};
    metal::int2 param_121 = {};
    metal::int2 param_122 = {};
    metal::int2 param_123 = {};
    metal::int2 param_124 = {};
    metal::int2 param_125 = {};
    metal::int2 param_126 = {};
    metal::int2 param_127 = {};
    metal::int2 param_128 = {};
    float a_9 = {};
    metal::int2 param_129 = {};
    float b_10 = {};
    metal::int2 param_130 = {};
    float c_8 = {};
    metal::int2 param_131 = {};
    float d_3 = {};
    metal::int2 param_132 = {};
    float f_1 = {};
    metal::int2 param_133 = {};
    float g_1 = {};
    metal::int2 param_134 = {};
    float q_6 = {};
    metal::int2 param_135 = {};
    float k_6 = {};
    metal::int2 param_136 = {};
    bool shaded = {};
    float zFactor_1 = {};
    float res = {};
    float local_28 = {};
    float dxS_1 = {};
    float dyS_1 = {};
    float dx_4 = {};
    float north_1 = {};
    float dy_4 = {};
    metal::float4 colour_1 = {};
    bool painted = {};
    float param_137 = {};
    float param_138 = {};
    float param_139 = {};
    float param_140 = {};
    float northness = {};
    float param_141 = {};
    float param_142 = {};
    float amount = {};
    metal::float3 neutral = {};
    metal::float3 target_1 = {};
    float interval_1 = {};
    float local_29 = {};
    float local_30 = {};
    float perPixel_1 = {};
    float spacing_1 = {};
    float multiple_1 = {};
    float distanceToLine_1 = {};
    float lineWidth_1 = {};
    bool indexLine_1 = {};
    float shade_1 = {};
    float param_143 = {};
    float param_144 = {};
    float param_145 = {};
    float param_146 = {};
    float aspect_1 = {};
    float param_147 = {};
    float param_148 = {};
    float sum_4 = {};
    float total_1 = {};
    int index_1 = {};
    float az_2 = {};
    float s_6 = {};
    float weight_1 = {};
    float local_31 = {};
    float param_149 = {};
    float param_150 = {};
    float param_151 = {};
    float direct = {};
    float shade_2 = {};
    float direct_1 = {};
    float param_152 = {};
    float param_153 = {};
    float param_154 = {};
    float shade_3 = {};
    metal::float3 straight_2 = {};
    metal::float3 local_32 = {};
    metal::float3 param_155 = {};
    bool phi_3222_ = {};
    bool phi_3232_ = {};
    bool phi_3240_ = {};
    bool phi_3248_ = {};
    bool phi_3258_ = {};
    bool phi_3266_ = {};
    bool phi_3276_ = {};
    bool phi_3346_ = {};
    bool phi_3353_ = {};
    metal::int2 _e372 = csp_size_u0028_(csk_field);
    size = _e372;
    metal::float2 _e373 = v_screenUv_1;
    metal::int2 _e374 = size;
    metal::int2 _e379 = size;
    p_6 = metal::clamp(naga_f2i32(metal::floor(_e373 * static_cast<metal::float2>(_e374))), metal::int2(0, 0), as_type<metal::int2>(as_type<metal::uint2>(_e379) - as_type<metal::uint2>(metal::int2(1, 1))));
    metal::int2 _e382 = p_6;
    param_112 = _e382;
    bool _e383 = csp_valid_u0028_vi2_u003b(param_112, csk_field);
    if (!(_e383)) {
        fragColor = metal::float4(0.0, 0.0, 0.0, 0.0);
        return;
    }
    metal::int2 _e385 = p_6;
    param_113 = _e385;
    float _e386 = csp_height_u0028_vi2_u003b(param_113, csk_field);
    value_7 = _e386;
    metal::float2 _e387 = v_screenUv_1;
    metal::float2 _e391 = unnamed.u_cssSize;
    cssOffset = (_e387 - metal::float2(0.5)) * _e391;
    float _e394 = unnamed.u_bearingRad;
    cosB_1 = metal::cos(_e394);
    float _e397 = unnamed.u_bearingRad;
    sinB_1 = metal::sin(_e397);
    float _e400 = unnamed.u_zoom;
    worldCss = 256.0 * metal::exp2(_e400);
    metal::float2 _e404 = unnamed.u_centerMerc;
    float _e406 = cssOffset[0u];
    float _e407 = cosB_1;
    float _e410 = cssOffset[1u];
    float _e411 = sinB_1;
    float _e415 = cssOffset[0u];
    float _e417 = sinB_1;
    float _e420 = cssOffset[1u];
    float _e421 = cosB_1;
    float _e425 = worldCss;
    merc_2 = _e404 + (metal::float2((_e406 * _e407) + (_e410 * _e411), (-(_e415) * _e417) + (_e420 * _e421)) / metal::float2(_e425));
    float _e430 = merc_2[1u];
    lat = metal::atan(metal::sinh(3.1415927 * (1.0 - (2.0 * _e430))));
    float _e436 = lat;
    float _e440 = unnamed.u_zoom;
    float _e444 = unnamed.u_dpr;
    mpp = (40075016.0 * metal::cos(_e436)) / ((256.0 * metal::exp2(_e440)) * _e444);
    float _e448 = unnamed.u_groundResOverride;
    if (_e448 > 0.0) {
        float _e451 = unnamed.u_groundResOverride;
        local_27 = _e451;
    } else {
        float _e452 = mpp;
        local_27 = _e452;
    }
    float _e453 = local_27;
    groundRes_1 = _e453;
    float _e454 = value_7;
    param_114 = _e454;
    metal::float4 _e455 = cspSpectrumColour_u0028_f1_u003b(param_114, unnamed);
    float _e457 = unnamed.u_spectrumOpacity;
    spectrum = _e455 * _e457;
    terrain = metal::float4(0.0, 0.0, 0.0, 0.0);
    float _e460 = unnamed.u_stackOn;
    if (_e460 > 0.5) {
        metal::int2 _e462 = p_6;
        param_115 = _e462;
        float _e463 = value_7;
        param_116 = _e463;
        float _e464 = groundRes_1;
        param_117 = _e464;
        float _e465 = cosB_1;
        param_118 = _e465;
        float _e466 = sinB_1;
        param_119 = _e466;
        metal::float2 _e467 = merc_2;
        param_120 = _e467;
        metal::float4 _e468 = cspStack_u0028_vi2_u003b_f1_u003b_f1_u003b_f1_u003b_f1_u003b_vf2_u003b(param_115, param_116, param_117, param_118, param_119, param_120, csk_field, unnamed, csk_blur, csk_base, csk_landBase, u_waterMask);
        terrain = _e468;
    } else {
        int _e470 = unnamed.u_style;
        if (_e470 >= 0) {
            px_1 = metal::int2(1, 0);
            py_1 = metal::int2(0, 1);
            metal::int2 _e472 = p_6;
            metal::int2 _e473 = px_1;
            metal::int2 _e475 = py_1;
            param_121 = as_type<metal::int2>(as_type<metal::uint2>(as_type<metal::int2>(as_type<metal::uint2>(_e472) - as_type<metal::uint2>(_e473))) - as_type<metal::uint2>(_e475));
            bool _e477 = csp_valid_u0028_vi2_u003b(param_121, csk_field);
            phi_3222_ = _e477;
            if (_e477) {
                metal::int2 _e478 = p_6;
                metal::int2 _e479 = py_1;
                param_122 = as_type<metal::int2>(as_type<metal::uint2>(_e478) - as_type<metal::uint2>(_e479));
                bool _e481 = csp_valid_u0028_vi2_u003b(param_122, csk_field);
                phi_3222_ = _e481;
            }
            bool _e483 = phi_3222_;
            phi_3232_ = _e483;
            if (_e483) {
                metal::int2 _e484 = p_6;
                metal::int2 _e485 = px_1;
                metal::int2 _e487 = py_1;
                param_123 = as_type<metal::int2>(as_type<metal::uint2>(as_type<metal::int2>(as_type<metal::uint2>(_e484) + as_type<metal::uint2>(_e485))) - as_type<metal::uint2>(_e487));
                bool _e489 = csp_valid_u0028_vi2_u003b(param_123, csk_field);
                phi_3232_ = _e489;
            }
            bool _e491 = phi_3232_;
            phi_3240_ = _e491;
            if (_e491) {
                metal::int2 _e492 = p_6;
                metal::int2 _e493 = px_1;
                param_124 = as_type<metal::int2>(as_type<metal::uint2>(_e492) - as_type<metal::uint2>(_e493));
                bool _e495 = csp_valid_u0028_vi2_u003b(param_124, csk_field);
                phi_3240_ = _e495;
            }
            bool _e497 = phi_3240_;
            phi_3248_ = _e497;
            if (_e497) {
                metal::int2 _e498 = p_6;
                metal::int2 _e499 = px_1;
                param_125 = as_type<metal::int2>(as_type<metal::uint2>(_e498) + as_type<metal::uint2>(_e499));
                bool _e501 = csp_valid_u0028_vi2_u003b(param_125, csk_field);
                phi_3248_ = _e501;
            }
            bool _e503 = phi_3248_;
            phi_3258_ = _e503;
            if (_e503) {
                metal::int2 _e504 = p_6;
                metal::int2 _e505 = px_1;
                metal::int2 _e507 = py_1;
                param_126 = as_type<metal::int2>(as_type<metal::uint2>(as_type<metal::int2>(as_type<metal::uint2>(_e504) - as_type<metal::uint2>(_e505))) + as_type<metal::uint2>(_e507));
                bool _e509 = csp_valid_u0028_vi2_u003b(param_126, csk_field);
                phi_3258_ = _e509;
            }
            bool _e511 = phi_3258_;
            phi_3266_ = _e511;
            if (_e511) {
                metal::int2 _e512 = p_6;
                metal::int2 _e513 = py_1;
                param_127 = as_type<metal::int2>(as_type<metal::uint2>(_e512) + as_type<metal::uint2>(_e513));
                bool _e515 = csp_valid_u0028_vi2_u003b(param_127, csk_field);
                phi_3266_ = _e515;
            }
            bool _e517 = phi_3266_;
            phi_3276_ = _e517;
            if (_e517) {
                metal::int2 _e518 = p_6;
                metal::int2 _e519 = px_1;
                metal::int2 _e521 = py_1;
                param_128 = as_type<metal::int2>(as_type<metal::uint2>(as_type<metal::int2>(as_type<metal::uint2>(_e518) + as_type<metal::uint2>(_e519))) + as_type<metal::uint2>(_e521));
                bool _e523 = csp_valid_u0028_vi2_u003b(param_128, csk_field);
                phi_3276_ = _e523;
            }
            bool _e525 = phi_3276_;
            allValid = _e525;
            bool _e526 = allValid;
            if (_e526) {
                metal::int2 _e527 = p_6;
                metal::int2 _e528 = px_1;
                metal::int2 _e530 = py_1;
                param_129 = as_type<metal::int2>(as_type<metal::uint2>(as_type<metal::int2>(as_type<metal::uint2>(_e527) - as_type<metal::uint2>(_e528))) - as_type<metal::uint2>(_e530));
                float _e532 = csp_height_u0028_vi2_u003b(param_129, csk_field);
                a_9 = _e532;
                metal::int2 _e533 = p_6;
                metal::int2 _e534 = py_1;
                param_130 = as_type<metal::int2>(as_type<metal::uint2>(_e533) - as_type<metal::uint2>(_e534));
                float _e536 = csp_height_u0028_vi2_u003b(param_130, csk_field);
                b_10 = _e536;
                metal::int2 _e537 = p_6;
                metal::int2 _e538 = px_1;
                metal::int2 _e540 = py_1;
                param_131 = as_type<metal::int2>(as_type<metal::uint2>(as_type<metal::int2>(as_type<metal::uint2>(_e537) + as_type<metal::uint2>(_e538))) - as_type<metal::uint2>(_e540));
                float _e542 = csp_height_u0028_vi2_u003b(param_131, csk_field);
                c_8 = _e542;
                metal::int2 _e543 = p_6;
                metal::int2 _e544 = px_1;
                param_132 = as_type<metal::int2>(as_type<metal::uint2>(_e543) - as_type<metal::uint2>(_e544));
                float _e546 = csp_height_u0028_vi2_u003b(param_132, csk_field);
                d_3 = _e546;
                metal::int2 _e547 = p_6;
                metal::int2 _e548 = px_1;
                param_133 = as_type<metal::int2>(as_type<metal::uint2>(_e547) + as_type<metal::uint2>(_e548));
                float _e550 = csp_height_u0028_vi2_u003b(param_133, csk_field);
                f_1 = _e550;
                metal::int2 _e551 = p_6;
                metal::int2 _e552 = px_1;
                metal::int2 _e554 = py_1;
                param_134 = as_type<metal::int2>(as_type<metal::uint2>(as_type<metal::int2>(as_type<metal::uint2>(_e551) - as_type<metal::uint2>(_e552))) + as_type<metal::uint2>(_e554));
                float _e556 = csp_height_u0028_vi2_u003b(param_134, csk_field);
                g_1 = _e556;
                metal::int2 _e557 = p_6;
                metal::int2 _e558 = py_1;
                param_135 = as_type<metal::int2>(as_type<metal::uint2>(_e557) + as_type<metal::uint2>(_e558));
                float _e560 = csp_height_u0028_vi2_u003b(param_135, csk_field);
                q_6 = _e560;
                metal::int2 _e561 = p_6;
                metal::int2 _e562 = px_1;
                metal::int2 _e564 = py_1;
                param_136 = as_type<metal::int2>(as_type<metal::uint2>(as_type<metal::int2>(as_type<metal::uint2>(_e561) + as_type<metal::uint2>(_e562))) + as_type<metal::uint2>(_e564));
                float _e566 = csp_height_u0028_vi2_u003b(param_136, csk_field);
                k_6 = _e566;
                int _e568 = unnamed.u_style;
                bool _e569 = _e568 == 0;
                phi_3346_ = _e569;
                if (!(_e569)) {
                    int _e572 = unnamed.u_style;
                    phi_3346_ = _e572 == 1;
                }
                bool _e575 = phi_3346_;
                phi_3353_ = _e575;
                if (!(_e575)) {
                    int _e578 = unnamed.u_style;
                    phi_3353_ = _e578 == 5;
                }
                bool _e581 = phi_3353_;
                shaded = _e581;
                float _e582 = groundRes_1;
                zFactor_1 = 1.0 + (0.024 * metal::pow(metal::max(_e582, 0.0), 0.664));
                bool _e587 = shaded;
                if (_e587) {
                    float _e588 = groundRes_1;
                    float _e589 = zFactor_1;
                    local_28 = _e588 / _e589;
                } else {
                    float _e591 = groundRes_1;
                    local_28 = _e591;
                }
                float _e592 = local_28;
                res = _e592;
                float _e593 = c_8;
                float _e594 = f_1;
                float _e597 = k_6;
                float _e599 = a_9;
                float _e600 = d_3;
                float _e603 = g_1;
                float _e606 = res;
                dxS_1 = (((_e593 + (2.0 * _e594)) + _e597) - ((_e599 + (2.0 * _e600)) + _e603)) / (8.0 * _e606);
                float _e609 = g_1;
                float _e610 = q_6;
                float _e613 = k_6;
                float _e615 = a_9;
                float _e616 = b_10;
                float _e619 = c_8;
                float _e622 = res;
                dyS_1 = (((_e609 + (2.0 * _e610)) + _e613) - ((_e615 + (2.0 * _e616)) + _e619)) / (8.0 * _e622);
                float _e625 = dxS_1;
                float _e626 = cosB_1;
                float _e628 = dyS_1;
                float _e629 = sinB_1;
                dx_4 = (_e625 * _e626) + (_e628 * _e629);
                float _e632 = dxS_1;
                float _e633 = sinB_1;
                float _e635 = dyS_1;
                float _e636 = cosB_1;
                north_1 = (_e632 * _e633) - (_e635 * _e636);
                float _e639 = north_1;
                dy_4 = -(_e639);
                colour_1 = metal::float4(0.0, 0.0, 0.0, 0.0);
                painted = true;
                int _e642 = unnamed.u_style;
                if (_e642 == 2) {
                    float _e644 = dx_4;
                    float _e645 = dy_4;
                    param_137 = ((metal::atan(metal::length(metal::float2(_e644, _e645)))) * 57.295779513082322865);
                    metal::float3 _e650 = cspSlopeColour_u0028_f1_u003b(param_137);
                    colour_1 = metal::float4(_e650.x, _e650.y, _e650.z, 1.0);
                } else {
                    int _e656 = unnamed.u_style;
                    if (_e656 == 3) {
                        float _e658 = dx_4;
                        float _e659 = dy_4;
                        if (metal::length(metal::float2(_e658, _e659)) <= 0.008726868) {
                            painted = false;
                        } else {
                            float _e663 = dx_4;
                            param_138 = _e663;
                            float _e664 = dy_4;
                            param_139 = _e664;
                            float _e665 = cspAspectOf_u0028_f1_u003b_f1_u003b(param_138, param_139);
                            param_140 = _e665;
                            metal::float3 _e666 = cspAspectColour_u0028_f1_u003b(param_140);
                            colour_1 = metal::float4(_e666.x, _e666.y, _e666.z, 1.0);
                        }
                    } else {
                        int _e672 = unnamed.u_style;
                        if (_e672 == 4) {
                            float _e674 = dx_4;
                            float _e675 = dy_4;
                            if (metal::length(metal::float2(_e674, _e675)) <= 0.008726868) {
                                painted = false;
                            } else {
                                float _e679 = dx_4;
                                param_141 = _e679;
                                float _e680 = dy_4;
                                param_142 = _e680;
                                float _e681 = cspAspectOf_u0028_f1_u003b_f1_u003b(param_141, param_142);
                                northness = metal::cos(((_e681) * 0.017453292519943295474));
                                float _e684 = northness;
                                amount = metal::abs(_e684);
                                neutral = metal::float3(0.96862745, 0.9529412, 0.8784314);
                                float _e686 = northness;
                                target_1 = metal::select(metal::float3(214.0, 82.0, 78.0), metal::float3(55.0, 137.0, 92.0), metal::bool3(_e686 >= 0.0)) / metal::float3(255.0);
                                metal::float3 _e692 = neutral;
                                metal::float3 _e693 = target_1;
                                float _e694 = amount;
                                metal::float3 _e696 = metal::mix(_e692, _e693, metal::float3(_e694));
                                colour_1 = metal::float4(_e696.x, _e696.y, _e696.z, 1.0);
                            }
                        } else {
                            int _e702 = unnamed.u_style;
                            if (_e702 >= 6) {
                                int _e705 = unnamed.u_style;
                                if (_e705 == 6) {
                                    local_29 = 2.0;
                                } else {
                                    int _e708 = unnamed.u_style;
                                    if (_e708 == 7) {
                                        local_30 = 5.0;
                                    } else {
                                        int _e711 = unnamed.u_style;
                                        local_30 = (_e711 == 8) ? 10.0 : 25.0;
                                    }
                                    float _e714 = local_30;
                                    local_29 = _e714;
                                }
                                float _e715 = local_29;
                                interval_1 = _e715;
                                float _e716 = dx_4;
                                float _e717 = dy_4;
                                float _e720 = res;
                                perPixel_1 = (metal::length(metal::float2(_e716, _e717)) * _e720) * 3.28084;
                                float _e723 = perPixel_1;
                                if (_e723 > 0.0) {
                                    float _e725 = interval_1;
                                    float _e726 = perPixel_1;
                                    spacing_1 = _e725 / _e726;
                                    float _e728 = spacing_1;
                                    if (_e728 < 3.0) {
                                        float _e730 = spacing_1;
                                        if ((_e730 * 5.0) >= 3.0) {
                                            float _e733 = interval_1;
                                            interval_1 = _e733 * 5.0;
                                        } else {
                                            painted = false;
                                        }
                                    }
                                }
                                bool _e735 = painted;
                                if (_e735) {
                                    float _e736 = value_7;
                                    float _e738 = interval_1;
                                    multiple_1 = (_e736 * 3.28084) / _e738;
                                    float _e740 = multiple_1;
                                    float _e741 = multiple_1;
                                    float _e745 = interval_1;
                                    distanceToLine_1 = metal::abs(_e740 - metal::rint(_e741)) * _e745;
                                    float _e747 = interval_1;
                                    float _e749 = perPixel_1;
                                    lineWidth_1 = metal::max(0.35, metal::min(_e747 * 0.5, _e749 * 0.7));
                                    float _e753 = distanceToLine_1;
                                    float _e754 = lineWidth_1;
                                    if (_e753 >= _e754) {
                                        painted = false;
                                    } else {
                                        float _e756 = multiple_1;
                                        float _e757 = metal::rint(_e756);
                                        indexLine_1 = metal::abs(_e757 - (metal::floor(_e757 / 5.0) * 5.0)) < 0.5;
                                        bool _e764 = indexLine_1;
                                        colour_1 = metal::select(metal::float4(0.5882353, 0.43137255, 0.3137255, 0.78431374), metal::float4(0.47058824, 0.27450982, 0.15686275, 1.0), metal::bool4(_e764));
                                    }
                                }
                            } else {
                                int _e768 = unnamed.u_style;
                                if (_e768 == 5) {
                                    float _e771 = unnamed.u_ambient;
                                    float _e773 = unnamed.u_ambient;
                                    float _e775 = dx_4;
                                    param_143 = _e775;
                                    float _e776 = dy_4;
                                    param_144 = _e776;
                                    float _e778 = unnamed.u_sunAzimuth;
                                    param_145 = _e778;
                                    float _e779 = cspDirectShade_u0028_f1_u003b_f1_u003b_f1_u003b(param_143, param_144, param_145, unnamed);
                                    shade_1 = _e771 + ((1.0 - _e773) * _e779);
                                    float _e782 = value_7;
                                    param_146 = _e782;
                                    metal::float3 _e783 = cspTintColour_u0028_f1_u003b(param_146);
                                    float _e784 = shade_1;
                                    metal::float3 _e788 = metal::min(_e783 * (0.33 + (0.82 * _e784)), metal::float3(1.0, 1.0, 1.0));
                                    colour_1 = metal::float4(_e788.x, _e788.y, _e788.z, 1.0);
                                } else {
                                    int _e794 = unnamed.u_style;
                                    if (_e794 == 1) {
                                        float _e796 = dx_4;
                                        param_147 = _e796;
                                        float _e797 = dy_4;
                                        param_148 = _e797;
                                        float _e798 = cspAspectOf_u0028_f1_u003b_f1_u003b(param_147, param_148);
                                        aspect_1 = _e798;
                                        sum_4 = 0.0;
                                        total_1 = 0.0;
                                        index_1 = 0;
                                        uint2 loop_bound_9 = uint2(4294967295u);
                                        bool loop_init_9 = true;
                                        while(true) {
                                            if (metal::all(loop_bound_9 == uint2(0u))) { break; }
                                            loop_bound_9 -= uint2(loop_bound_9.y == 0u, 1u);
                                            if (!loop_init_9) {
                                                int _e837 = index_1;
                                                index_1 = as_type<int>(as_type<uint>(_e837) + as_type<uint>(1));
                                            }
                                            loop_init_9 = false;
                                            int _e799 = index_1;
                                            if (_e799 < 4) {
                                                float _e802 = unnamed.u_sunAzimuth;
                                                int _e804 = index_1;
                                                az_2 = (_e802 - 90.0) + (45.0 * static_cast<float>(_e804));
                                                float _e808 = aspect_1;
                                                float _e809 = az_2;
                                                s_6 = metal::sin((((_e808 - (_e809 - (metal::floor(_e809 / 360.0) * 360.0)))) * 0.017453292519943295474));
                                                float _e817 = dx_4;
                                                float _e818 = dy_4;
                                                if (metal::length(metal::float2(_e817, _e818)) < 0.000000000001) {
                                                    local_31 = 1.0;
                                                } else {
                                                    float _e822 = s_6;
                                                    float _e823 = s_6;
                                                    local_31 = _e822 * _e823;
                                                }
                                                float _e825 = local_31;
                                                weight_1 = _e825;
                                                float _e826 = weight_1;
                                                float _e827 = dx_4;
                                                param_149 = _e827;
                                                float _e828 = dy_4;
                                                param_150 = _e828;
                                                float _e829 = az_2;
                                                param_151 = _e829;
                                                float _e830 = cspDirectShade_u0028_f1_u003b_f1_u003b_f1_u003b(param_149, param_150, param_151, unnamed);
                                                float _e832 = sum_4;
                                                sum_4 = _e832 + (_e826 * _e830);
                                                float _e834 = weight_1;
                                                float _e835 = total_1;
                                                total_1 = _e835 + _e834;
                                                continue;
                                            } else {
                                                break;
                                            }
                                        }
                                        float _e839 = sum_4;
                                        float _e840 = total_1;
                                        direct = _e839 / metal::max(_e840, 0.00001);
                                        float _e844 = unnamed.u_ambient;
                                        float _e846 = unnamed.u_ambient;
                                        float _e848 = direct;
                                        shade_2 = _e844 + ((1.0 - _e846) * _e848);
                                        float _e851 = shade_2;
                                        metal::float3 _e852 = metal::float3(_e851);
                                        colour_1 = metal::float4(_e852.x, _e852.y, _e852.z, 1.0);
                                    } else {
                                        float _e857 = dx_4;
                                        param_152 = _e857;
                                        float _e858 = dy_4;
                                        param_153 = _e858;
                                        float _e860 = unnamed.u_sunAzimuth;
                                        param_154 = _e860;
                                        float _e861 = cspDirectShade_u0028_f1_u003b_f1_u003b_f1_u003b(param_152, param_153, param_154, unnamed);
                                        direct_1 = _e861;
                                        float _e863 = unnamed.u_ambient;
                                        float _e865 = unnamed.u_ambient;
                                        float _e867 = direct_1;
                                        shade_3 = _e863 + ((1.0 - _e865) * _e867);
                                        float _e870 = shade_3;
                                        metal::float3 _e871 = metal::float3(_e870);
                                        colour_1 = metal::float4(_e871.x, _e871.y, _e871.z, 1.0);
                                    }
                                }
                            }
                        }
                    }
                }
                bool _e876 = painted;
                if (_e876) {
                    float _e878 = colour_1[3u];
                    if (_e878 > 0.0) {
                        metal::float4 _e880 = colour_1;
                        param_155 = _e880.xyz;
                        metal::float3 _e882 = cspApplyAppearance_u0028_vf3_u003b(param_155, unnamed);
                        local_32 = _e882;
                    } else {
                        local_32 = metal::float3(0.0, 0.0, 0.0);
                    }
                    metal::float3 _e883 = local_32;
                    straight_2 = _e883;
                    metal::float3 _e884 = straight_2;
                    float _e886 = colour_1[3u];
                    metal::float3 _e887 = _e884 * _e886;
                    float _e889 = colour_1[3u];
                    float _e895 = unnamed.u_terrainOpacity;
                    terrain = metal::float4(_e887.x, _e887.y, _e887.z, _e889) * _e895;
                }
            }
        }
    }
    metal::float4 _e897 = spectrum;
    metal::float4 _e898 = terrain;
    float _e900 = spectrum[3u];
    fragColor = _e897 + (_e898 * (1.0 - _e900));
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
, metal::texture2d<float, metal::access::sample> csk_field [[texture(1)]]
, constant CskUniforms& unnamed [[buffer(0)]]
, metal::texture2d<float, metal::access::sample> csk_blur [[texture(2)]]
, metal::texture2d<float, metal::access::sample> csk_base [[texture(3)]]
, metal::texture2d<float, metal::access::sample> csk_landBase [[texture(4)]]
, metal::texture2d<uint, metal::access::sample> u_waterMask [[texture(5)]]
) {
    metal::float2 v_screenUv_1 = {};
    metal::float4 fragColor = {};
    const auto v_screenUv = varyings.v_screenUv;
    v_screenUv_1 = v_screenUv;
    main_1(csk_field, unnamed, csk_blur, csk_base, csk_landBase, u_waterMask, v_screenUv_1, fragColor);
    metal::float4 _e3 = fragColor;
    return main_Output { _e3 };
}
