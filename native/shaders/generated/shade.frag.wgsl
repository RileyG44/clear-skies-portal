struct CspCtx {
    p: vec2<i32>,
    height: f32,
    base: f32,
    dx: f32,
    dy: f32,
    sdx: f32,
    sdy: f32,
    res: f32,
    slope: f32,
    aspect: f32,
}

struct CskUniforms {
    csk_blurScale: f32,
    csk_pad_csk_blurScale_1_: f32,
    csk_pad_csk_blurScale_2_: f32,
    csk_pad_csk_blurScale_3_: f32,
    csk_baseScale: f32,
    csk_pad_csk_baseScale_1_: f32,
    csk_pad_csk_baseScale_2_: f32,
    csk_pad_csk_baseScale_3_: f32,
    csk_landBaseScale: f32,
    csk_pad_csk_landBaseScale_1_: f32,
    csk_pad_csk_landBaseScale_2_: f32,
    csk_pad_csk_landBaseScale_3_: f32,
    csk_auxTransform: mat3x3<f32>,
    u_style: i32,
    csk_pad_u_style_1_: f32,
    csk_pad_u_style_2_: f32,
    csk_pad_u_style_3_: f32,
    u_terrainOpacity: f32,
    csk_pad_u_terrainOpacity_1_: f32,
    csk_pad_u_terrainOpacity_2_: f32,
    csk_pad_u_terrainOpacity_3_: f32,
    u_sunAzimuth: f32,
    csk_pad_u_sunAzimuth_1_: f32,
    csk_pad_u_sunAzimuth_2_: f32,
    csk_pad_u_sunAzimuth_3_: f32,
    u_sunAltitude: f32,
    csk_pad_u_sunAltitude_1_: f32,
    csk_pad_u_sunAltitude_2_: f32,
    csk_pad_u_sunAltitude_3_: f32,
    u_ambient: f32,
    csk_pad_u_ambient_1_: f32,
    csk_pad_u_ambient_2_: f32,
    csk_pad_u_ambient_3_: f32,
    u_lookSaturation: f32,
    csk_pad_u_lookSaturation_1_: f32,
    csk_pad_u_lookSaturation_2_: f32,
    csk_pad_u_lookSaturation_3_: f32,
    u_lookContrast: f32,
    csk_pad_u_lookContrast_1_: f32,
    csk_pad_u_lookContrast_2_: f32,
    csk_pad_u_lookContrast_3_: f32,
    u_lookBrightness: f32,
    csk_pad_u_lookBrightness_1_: f32,
    csk_pad_u_lookBrightness_2_: f32,
    csk_pad_u_lookBrightness_3_: f32,
    u_spectrumOn: f32,
    csk_pad_u_spectrumOn_1_: f32,
    csk_pad_u_spectrumOn_2_: f32,
    csk_pad_u_spectrumOn_3_: f32,
    u_spectrumLevel: f32,
    csk_pad_u_spectrumLevel_1_: f32,
    csk_pad_u_spectrumLevel_2_: f32,
    csk_pad_u_spectrumLevel_3_: f32,
    u_spectrumSpan: f32,
    csk_pad_u_spectrumSpan_1_: f32,
    csk_pad_u_spectrumSpan_2_: f32,
    csk_pad_u_spectrumSpan_3_: f32,
    u_spectrumAlpha: f32,
    csk_pad_u_spectrumAlpha_1_: f32,
    csk_pad_u_spectrumAlpha_2_: f32,
    csk_pad_u_spectrumAlpha_3_: f32,
    u_spectrumLow: vec3<f32>,
    csk_pad_u_spectrumLow_3_: f32,
    u_spectrumMid: vec3<f32>,
    csk_pad_u_spectrumMid_3_: f32,
    u_spectrumHigh: vec3<f32>,
    csk_pad_u_spectrumHigh_3_: f32,
    u_belowOn: f32,
    csk_pad_u_belowOn_1_: f32,
    csk_pad_u_belowOn_2_: f32,
    csk_pad_u_belowOn_3_: f32,
    u_belowLevel: f32,
    csk_pad_u_belowLevel_1_: f32,
    csk_pad_u_belowLevel_2_: f32,
    csk_pad_u_belowLevel_3_: f32,
    u_belowColor: vec3<f32>,
    csk_pad_u_belowColor_3_: f32,
    u_aboveOn: f32,
    csk_pad_u_aboveOn_1_: f32,
    csk_pad_u_aboveOn_2_: f32,
    csk_pad_u_aboveOn_3_: f32,
    u_aboveLevel: f32,
    csk_pad_u_aboveLevel_1_: f32,
    csk_pad_u_aboveLevel_2_: f32,
    csk_pad_u_aboveLevel_3_: f32,
    u_aboveColor: vec3<f32>,
    csk_pad_u_aboveColor_3_: f32,
    u_bandAlpha: f32,
    csk_pad_u_bandAlpha_1_: f32,
    csk_pad_u_bandAlpha_2_: f32,
    csk_pad_u_bandAlpha_3_: f32,
    u_bandFeather: f32,
    csk_pad_u_bandFeather_1_: f32,
    csk_pad_u_bandFeather_2_: f32,
    csk_pad_u_bandFeather_3_: f32,
    u_outlineOn: f32,
    csk_pad_u_outlineOn_1_: f32,
    csk_pad_u_outlineOn_2_: f32,
    csk_pad_u_outlineOn_3_: f32,
    u_outlineWidth: f32,
    csk_pad_u_outlineWidth_1_: f32,
    csk_pad_u_outlineWidth_2_: f32,
    csk_pad_u_outlineWidth_3_: f32,
    u_spectrumOpacity: f32,
    csk_pad_u_spectrumOpacity_1_: f32,
    csk_pad_u_spectrumOpacity_2_: f32,
    csk_pad_u_spectrumOpacity_3_: f32,
    u_centerMerc: vec2<f32>,
    csk_pad_u_centerMerc_2_: f32,
    csk_pad_u_centerMerc_3_: f32,
    u_zoom: f32,
    csk_pad_u_zoom_1_: f32,
    csk_pad_u_zoom_2_: f32,
    csk_pad_u_zoom_3_: f32,
    u_bearingRad: f32,
    csk_pad_u_bearingRad_1_: f32,
    csk_pad_u_bearingRad_2_: f32,
    csk_pad_u_bearingRad_3_: f32,
    u_cssSize: vec2<f32>,
    csk_pad_u_cssSize_2_: f32,
    csk_pad_u_cssSize_3_: f32,
    u_dpr: f32,
    csk_pad_u_dpr_1_: f32,
    csk_pad_u_dpr_2_: f32,
    csk_pad_u_dpr_3_: f32,
    u_groundResOverride: f32,
    csk_pad_u_groundResOverride_1_: f32,
    csk_pad_u_groundResOverride_2_: f32,
    csk_pad_u_groundResOverride_3_: f32,
    u_stackOn: f32,
    csk_pad_u_stackOn_1_: f32,
    csk_pad_u_stackOn_2_: f32,
    csk_pad_u_stackOn_3_: f32,
    u_stackGradient: f32,
    csk_pad_u_stackGradient_1_: f32,
    csk_pad_u_stackGradient_2_: f32,
    csk_pad_u_stackGradient_3_: f32,
    u_layerCount: f32,
    csk_pad_u_layerCount_1_: f32,
    csk_pad_u_layerCount_2_: f32,
    csk_pad_u_layerCount_3_: f32,
    u_layerA: array<vec4<f32>, 4>,
    u_layerB: array<vec4<f32>, 4>,
    u_layerC: array<vec4<f32>, 4>,
    u_layerD: array<vec4<f32>, 4>,
    u_layerPos: array<vec4<f32>, 12>,
    u_layerColors: array<vec4<f32>, 40>,
    u_detail: f32,
    csk_pad_u_detail_1_: f32,
    csk_pad_u_detail_2_: f32,
    csk_pad_u_detail_3_: f32,
    u_reliefExag: f32,
    csk_pad_u_reliefExag_1_: f32,
    csk_pad_u_reliefExag_2_: f32,
    csk_pad_u_reliefExag_3_: f32,
    u_remFlatBase: f32,
    csk_pad_u_remFlatBase_1_: f32,
    csk_pad_u_remFlatBase_2_: f32,
    csk_pad_u_remFlatBase_3_: f32,
    u_remLandBase: f32,
    csk_pad_u_remLandBase_1_: f32,
    csk_pad_u_remLandBase_2_: f32,
    csk_pad_u_remLandBase_3_: f32,
}

@group(0) @binding(1) 
var csk_field: texture_2d<f32>;
@group(0) @binding(0) 
var<uniform> unnamed: CskUniforms;
@group(0) @binding(2) 
var csk_blur: texture_2d<f32>;
@group(0) @binding(3) 
var csk_base: texture_2d<f32>;
@group(0) @binding(4) 
var csk_landBase: texture_2d<f32>;
@group(0) @binding(5) 
var u_waterMask: texture_2d<u32>;
var<private> v_screenUv_1: vec2<f32>;
var<private> fragColor: vec4<f32>;

fn cspApplyAppearance_u0028_vf3_u003b(straight: ptr<function, vec3<f32>>) -> vec3<f32> {
    var s: f32;
    var c: vec3<f32>;

    let _e268: f32 = unnamed.u_lookSaturation;
    s = _e268;
    let _e269: f32 = s;
    let _e273: f32 = (*straight)[0u];
    let _e275: f32 = s;
    let _e279: f32 = (*straight)[1u];
    let _e282: f32 = s;
    let _e286: f32 = (*straight)[2u];
    let _e289: f32 = s;
    let _e293: f32 = (*straight)[0u];
    let _e295: f32 = s;
    let _e299: f32 = (*straight)[1u];
    let _e302: f32 = s;
    let _e306: f32 = (*straight)[2u];
    let _e309: f32 = s;
    let _e313: f32 = (*straight)[0u];
    let _e315: f32 = s;
    let _e319: f32 = (*straight)[1u];
    let _e322: f32 = s;
    let _e326: f32 = (*straight)[2u];
    c = vec3<f32>(((((0.213f + (0.787f * _e269)) * _e273) + ((0.715f - (0.715f * _e275)) * _e279)) + ((0.072f - (0.072f * _e282)) * _e286)), ((((0.213f - (0.213f * _e289)) * _e293) + ((0.715f + (0.285f * _e295)) * _e299)) + ((0.072f - (0.072f * _e302)) * _e306)), ((((0.213f - (0.213f * _e309)) * _e313) + ((0.715f - (0.715f * _e315)) * _e319)) + ((0.072f + (0.928f * _e322)) * _e326)));
    let _e330: vec3<f32> = c;
    c = clamp(_e330, vec3(0f), vec3(1f));
    let _e334: vec3<f32> = c;
    let _e336: f32 = unnamed.u_lookContrast;
    let _e339: f32 = unnamed.u_lookContrast;
    c = clamp(((_e334 * _e336) + vec3(((1f - _e339) * 0.5f))), vec3(0f), vec3(1f));
    let _e347: vec3<f32> = c;
    let _e349: f32 = unnamed.u_lookBrightness;
    c = clamp((_e347 * _e349), vec3(0f), vec3(1f));
    let _e354: vec3<f32> = c;
    return _e354;
}

fn cspTintColour_u0028_f1_u003b(value: ptr<function, f32>) -> vec3<f32> {
    var c0_: vec3<f32>;
    var c1_: vec3<f32>;
    var c2_: vec3<f32>;
    var c3_: vec3<f32>;
    var c4_: vec3<f32>;
    var c5_: vec3<f32>;
    var c6_: vec3<f32>;
    var c7_: vec3<f32>;

    c0_ = vec3<f32>(0.08627451f, 0.18039216f, 0.28235295f);
    c1_ = vec3<f32>(0.15686275f, 0.27450982f, 0.37254903f);
    c2_ = vec3<f32>(0.27450982f, 0.43137255f, 0.27450982f);
    c3_ = vec3<f32>(0.5019608f, 0.54901963f, 0.36078432f);
    c4_ = vec3<f32>(0.627451f, 0.54901963f, 0.42352942f);
    c5_ = vec3<f32>(0.74509805f, 0.7058824f, 0.6666667f);
    c6_ = vec3<f32>(0.9607843f, 0.9647059f, 0.98039216f);
    c7_ = vec3<f32>(1f, 1f, 1f);
    let _e273: f32 = (*value);
    if (_e273 <= -500f) {
        let _e275: vec3<f32> = c0_;
        return _e275;
    }
    let _e276: f32 = (*value);
    if (_e276 <= 0f) {
        let _e278: vec3<f32> = c0_;
        let _e279: vec3<f32> = c1_;
        let _e280: f32 = (*value);
        return mix(_e278, _e279, vec3(((_e280 + 500f) / 500f)));
    }
    let _e285: f32 = (*value);
    if (_e285 <= 300f) {
        let _e287: vec3<f32> = c1_;
        let _e288: vec3<f32> = c2_;
        let _e289: f32 = (*value);
        return mix(_e287, _e288, vec3((_e289 / 300f)));
    }
    let _e293: f32 = (*value);
    if (_e293 <= 900f) {
        let _e295: vec3<f32> = c2_;
        let _e296: vec3<f32> = c3_;
        let _e297: f32 = (*value);
        return mix(_e295, _e296, vec3(((_e297 - 300f) / 600f)));
    }
    let _e302: f32 = (*value);
    if (_e302 <= 1600f) {
        let _e304: vec3<f32> = c3_;
        let _e305: vec3<f32> = c4_;
        let _e306: f32 = (*value);
        return mix(_e304, _e305, vec3(((_e306 - 900f) / 700f)));
    }
    let _e311: f32 = (*value);
    if (_e311 <= 2400f) {
        let _e313: vec3<f32> = c4_;
        let _e314: vec3<f32> = c5_;
        let _e315: f32 = (*value);
        return mix(_e313, _e314, vec3(((_e315 - 1600f) / 800f)));
    }
    let _e320: f32 = (*value);
    if (_e320 <= 3200f) {
        let _e322: vec3<f32> = c5_;
        let _e323: vec3<f32> = c6_;
        let _e324: f32 = (*value);
        return mix(_e322, _e323, vec3(((_e324 - 2400f) / 800f)));
    }
    let _e329: f32 = (*value);
    if (_e329 <= 6000f) {
        let _e331: vec3<f32> = c6_;
        let _e332: vec3<f32> = c7_;
        let _e333: f32 = (*value);
        return mix(_e331, _e332, vec3(((_e333 - 3200f) / 2800f)));
    }
    let _e338: vec3<f32> = c7_;
    return _e338;
}

fn cspDirectShade_u0028_f1_u003b_f1_u003b_f1_u003b(dx: ptr<function, f32>, dy: ptr<function, f32>, azimuth: ptr<function, f32>) -> f32 {
    var east: f32;
    var north: f32;
    var altitude: f32;
    var az: f32;

    let _e271: f32 = (*dx);
    east = _e271;
    let _e272: f32 = (*dy);
    north = -(_e272);
    let _e275: f32 = unnamed.u_sunAltitude;
    altitude = radians(_e275);
    let _e277: f32 = (*azimuth);
    az = radians(_e277);
    let _e279: f32 = east;
    let _e281: f32 = altitude;
    let _e284: f32 = az;
    let _e287: f32 = north;
    let _e288: f32 = altitude;
    let _e291: f32 = az;
    let _e295: f32 = altitude;
    let _e298: f32 = east;
    let _e299: f32 = east;
    let _e301: f32 = north;
    let _e302: f32 = north;
    return clamp((((((-(_e279) * cos(_e281)) * sin(_e284)) - ((_e287 * cos(_e288)) * cos(_e291))) + sin(_e295)) / sqrt((((_e298 * _e299) + (_e301 * _e302)) + 1f))), 0f, 1f);
}

fn cspAspectColour_u0028_f1_u003b(degreesValue: ptr<function, f32>) -> vec3<f32> {
    var sector: f32;
    var t: f32;
    var a: vec3<f32>;
    var b: vec3<f32>;

    let _e269: f32 = (*degreesValue);
    sector = floor((_e269 / 45f));
    let _e272: f32 = (*degreesValue);
    t = fract((_e272 / 45f));
    let _e275: f32 = sector;
    if (_e275 < 1f) {
        a = vec3<f32>(77f, 120f, 200f);
        b = vec3<f32>(59f, 165f, 176f);
    } else {
        let _e277: f32 = sector;
        if (_e277 < 2f) {
            a = vec3<f32>(59f, 165f, 176f);
            b = vec3<f32>(87f, 167f, 101f);
        } else {
            let _e279: f32 = sector;
            if (_e279 < 3f) {
                a = vec3<f32>(87f, 167f, 101f);
                b = vec3<f32>(201f, 173f, 79f);
            } else {
                let _e281: f32 = sector;
                if (_e281 < 4f) {
                    a = vec3<f32>(201f, 173f, 79f);
                    b = vec3<f32>(217f, 107f, 82f);
                } else {
                    let _e283: f32 = sector;
                    if (_e283 < 5f) {
                        a = vec3<f32>(217f, 107f, 82f);
                        b = vec3<f32>(196f, 91f, 130f);
                    } else {
                        let _e285: f32 = sector;
                        if (_e285 < 6f) {
                            a = vec3<f32>(196f, 91f, 130f);
                            b = vec3<f32>(141f, 101f, 187f);
                        } else {
                            let _e287: f32 = sector;
                            if (_e287 < 7f) {
                                a = vec3<f32>(141f, 101f, 187f);
                                b = vec3<f32>(94f, 119f, 197f);
                            } else {
                                a = vec3<f32>(94f, 119f, 197f);
                                b = vec3<f32>(77f, 120f, 200f);
                            }
                        }
                    }
                }
            }
        }
    }
    let _e289: vec3<f32> = a;
    let _e290: vec3<f32> = b;
    let _e291: f32 = t;
    return (mix(_e289, _e290, vec3(_e291)) / vec3(255f));
}

fn cspAspectOf_u0028_f1_u003b_f1_u003b(dx_1: ptr<function, f32>, dy_1: ptr<function, f32>) -> f32 {
    let _e266: f32 = (*dx_1);
    let _e268: f32 = (*dy_1);
    let _e271: f32 = (degrees(atan2(-(_e266), _e268)) + 360f);
    return (_e271 - (floor((_e271 / 360f)) * 360f));
}

fn cspRamp_u0028_f1_u003b_vf3_u003b_f1_u003b_vf3_u003b_f1_u003b_vf3_u003b_f1_u003b_vf3_u003b_f1_u003b_vf3_u003b_f1_u003b_vf3_u003b_f1_u003b_vf3_u003b(value_1: ptr<function, f32>, c0_1: ptr<function, vec3<f32>>, v1_: ptr<function, f32>, c1_1: ptr<function, vec3<f32>>, v2_: ptr<function, f32>, c2_1: ptr<function, vec3<f32>>, v3_: ptr<function, f32>, c3_1: ptr<function, vec3<f32>>, v4_: ptr<function, f32>, c4_1: ptr<function, vec3<f32>>, v5_: ptr<function, f32>, c5_1: ptr<function, vec3<f32>>, v6_: ptr<function, f32>, c6_1: ptr<function, vec3<f32>>) -> vec3<f32> {
    let _e278: f32 = (*value_1);
    let _e279: f32 = (*v1_);
    if (_e278 <= _e279) {
        let _e281: vec3<f32> = (*c0_1);
        let _e282: vec3<f32> = (*c1_1);
        let _e283: f32 = (*value_1);
        let _e284: f32 = (*v1_);
        return mix(_e281, _e282, vec3(clamp((_e283 / max(_e284, 0.0001f)), 0f, 1f)));
    }
    let _e290: f32 = (*value_1);
    let _e291: f32 = (*v2_);
    if (_e290 <= _e291) {
        let _e293: vec3<f32> = (*c1_1);
        let _e294: vec3<f32> = (*c2_1);
        let _e295: f32 = (*value_1);
        let _e296: f32 = (*v1_);
        let _e298: f32 = (*v2_);
        let _e299: f32 = (*v1_);
        return mix(_e293, _e294, vec3(((_e295 - _e296) / (_e298 - _e299))));
    }
    let _e304: f32 = (*value_1);
    let _e305: f32 = (*v3_);
    if (_e304 <= _e305) {
        let _e307: vec3<f32> = (*c2_1);
        let _e308: vec3<f32> = (*c3_1);
        let _e309: f32 = (*value_1);
        let _e310: f32 = (*v2_);
        let _e312: f32 = (*v3_);
        let _e313: f32 = (*v2_);
        return mix(_e307, _e308, vec3(((_e309 - _e310) / (_e312 - _e313))));
    }
    let _e318: f32 = (*value_1);
    let _e319: f32 = (*v4_);
    if (_e318 <= _e319) {
        let _e321: vec3<f32> = (*c3_1);
        let _e322: vec3<f32> = (*c4_1);
        let _e323: f32 = (*value_1);
        let _e324: f32 = (*v3_);
        let _e326: f32 = (*v4_);
        let _e327: f32 = (*v3_);
        return mix(_e321, _e322, vec3(((_e323 - _e324) / (_e326 - _e327))));
    }
    let _e332: f32 = (*value_1);
    let _e333: f32 = (*v5_);
    if (_e332 <= _e333) {
        let _e335: vec3<f32> = (*c4_1);
        let _e336: vec3<f32> = (*c5_1);
        let _e337: f32 = (*value_1);
        let _e338: f32 = (*v4_);
        let _e340: f32 = (*v5_);
        let _e341: f32 = (*v4_);
        return mix(_e335, _e336, vec3(((_e337 - _e338) / (_e340 - _e341))));
    }
    let _e346: f32 = (*value_1);
    let _e347: f32 = (*v6_);
    if (_e346 <= _e347) {
        let _e349: vec3<f32> = (*c5_1);
        let _e350: vec3<f32> = (*c6_1);
        let _e351: f32 = (*value_1);
        let _e352: f32 = (*v5_);
        let _e354: f32 = (*v6_);
        let _e355: f32 = (*v5_);
        return mix(_e349, _e350, vec3(((_e351 - _e352) / (_e354 - _e355))));
    }
    let _e360: vec3<f32> = (*c6_1);
    return _e360;
}

fn cspSlopeColour_u0028_f1_u003b(degreesValue_1: ptr<function, f32>) -> vec3<f32> {
    var param: f32;
    var param_1: vec3<f32>;
    var param_2: f32;
    var param_3: vec3<f32>;
    var param_4: f32;
    var param_5: vec3<f32>;
    var param_6: f32;
    var param_7: vec3<f32>;
    var param_8: f32;
    var param_9: vec3<f32>;
    var param_10: f32;
    var param_11: vec3<f32>;
    var param_12: f32;
    var param_13: vec3<f32>;

    let _e279: f32 = (*degreesValue_1);
    param = _e279;
    param_1 = vec3<f32>(0.9490196f, 0.95686275f, 0.93333334f);
    param_2 = 5f;
    param_3 = vec3<f32>(0.69411767f, 0.8235294f, 0.54509807f);
    param_4 = 15f;
    param_5 = vec3<f32>(0.9647059f, 0.85490197f, 0.43529412f);
    param_6 = 30f;
    param_7 = vec3<f32>(0.9411765f, 0.5882353f, 0.28627452f);
    param_8 = 45f;
    param_9 = vec3<f32>(0.8352941f, 0.27450982f, 0.3137255f);
    param_10 = 60f;
    param_11 = vec3<f32>(0.4627451f, 0.17254902f, 0.4117647f);
    param_12 = 90f;
    param_13 = vec3<f32>(0.19607843f, 0.09803922f, 0.28235295f);
    let _e280: vec3<f32> = cspRamp_u0028_f1_u003b_vf3_u003b_f1_u003b_vf3_u003b_f1_u003b_vf3_u003b_f1_u003b_vf3_u003b_f1_u003b_vf3_u003b_f1_u003b_vf3_u003b_f1_u003b_vf3_u003b((&param), (&param_1), (&param_2), (&param_3), (&param_4), (&param_5), (&param_6), (&param_7), (&param_8), (&param_9), (&param_10), (&param_11), (&param_12), (&param_13));
    return _e280;
}

fn cspLum_u0028_vf3_u003b(c_1: ptr<function, vec3<f32>>) -> f32 {
    let _e265: vec3<f32> = (*c_1);
    return dot(_e265, vec3<f32>(0.3f, 0.59f, 0.11f));
}

fn cspClipColour_u0028_vf3_u003b(c_2: ptr<function, vec3<f32>>) -> vec3<f32> {
    var l: f32;
    var param_14: vec3<f32>;
    var n: f32;
    var x: f32;

    let _e269: vec3<f32> = (*c_2);
    param_14 = _e269;
    let _e270: f32 = cspLum_u0028_vf3_u003b((&param_14));
    l = _e270;
    let _e272: f32 = (*c_2)[0u];
    let _e274: f32 = (*c_2)[1u];
    let _e277: f32 = (*c_2)[2u];
    n = min(min(_e272, _e274), _e277);
    let _e280: f32 = (*c_2)[0u];
    let _e282: f32 = (*c_2)[1u];
    let _e285: f32 = (*c_2)[2u];
    x = max(max(_e280, _e282), _e285);
    let _e287: f32 = n;
    if (_e287 < 0f) {
        let _e289: f32 = l;
        let _e290: vec3<f32> = (*c_2);
        let _e291: f32 = l;
        let _e294: f32 = l;
        let _e296: f32 = l;
        let _e297: f32 = n;
        (*c_2) = (vec3(_e289) + (((_e290 - vec3(_e291)) * _e294) / vec3(max((_e296 - _e297), 0.000001f))));
    }
    let _e304: f32 = x;
    if (_e304 > 1f) {
        let _e306: f32 = l;
        let _e307: vec3<f32> = (*c_2);
        let _e308: f32 = l;
        let _e311: f32 = l;
        let _e314: f32 = x;
        let _e315: f32 = l;
        (*c_2) = (vec3(_e306) + (((_e307 - vec3(_e308)) * (1f - _e311)) / vec3(max((_e314 - _e315), 0.000001f))));
    }
    let _e322: vec3<f32> = (*c_2);
    return _e322;
}

fn cspSetLum_u0028_vf3_u003b_f1_u003b(c_3: ptr<function, vec3<f32>>, l_1: ptr<function, f32>) -> vec3<f32> {
    var param_15: vec3<f32>;
    var param_16: vec3<f32>;

    let _e268: vec3<f32> = (*c_3);
    let _e269: f32 = (*l_1);
    let _e270: vec3<f32> = (*c_3);
    param_15 = _e270;
    let _e271: f32 = cspLum_u0028_vf3_u003b((&param_15));
    param_16 = (_e268 + vec3((_e269 - _e271)));
    let _e275: vec3<f32> = cspClipColour_u0028_vf3_u003b((&param_16));
    return _e275;
}

fn cspSoftLight_u0028_vf3_u003b_vf3_u003b(b_1: ptr<function, vec3<f32>>, s_1: ptr<function, vec3<f32>>) -> vec3<f32> {
    var d: vec3<f32>;

    let _e267: vec3<f32> = (*b_1);
    let _e271: vec3<f32> = (*b_1);
    let _e275: vec3<f32> = (*b_1);
    let _e277: vec3<f32> = (*b_1);
    let _e279: vec3<f32> = (*b_1);
    d = mix((((((_e267 * 16f) - vec3(12f)) * _e271) + vec3(4f)) * _e275), sqrt(_e277), step(vec3(0.25f), _e279));
    let _e283: vec3<f32> = (*b_1);
    let _e284: vec3<f32> = (*s_1);
    let _e288: vec3<f32> = (*b_1);
    let _e290: vec3<f32> = (*b_1);
    let _e295: vec3<f32> = (*b_1);
    let _e296: vec3<f32> = (*s_1);
    let _e300: vec3<f32> = d;
    let _e301: vec3<f32> = (*b_1);
    let _e305: vec3<f32> = (*s_1);
    return mix((_e283 - (((vec3(1f) - (_e284 * 2f)) * _e288) * (vec3(1f) - _e290))), (_e295 + (((_e296 * 2f) - vec3(1f)) * (_e300 - _e301))), step(vec3(0.5f), _e305));
}

fn cspHardLight_u0028_vf3_u003b_vf3_u003b(b_2: ptr<function, vec3<f32>>, s_2: ptr<function, vec3<f32>>) -> vec3<f32> {
    let _e266: vec3<f32> = (*b_2);
    let _e268: vec3<f32> = (*s_2);
    let _e270: vec3<f32> = (*b_2);
    let _e273: vec3<f32> = (*s_2);
    let _e282: vec3<f32> = (*s_2);
    return mix(((_e266 * 2f) * _e268), (vec3(1f) - ((vec3(1f) - _e270) * (vec3(1f) - ((_e273 * 2f) - vec3(1f))))), step(vec3(0.5f), _e282));
}

fn cspBlendMode_u0028_i1_u003b_vf3_u003b_vf3_u003b(mode: ptr<function, i32>, b_3: ptr<function, vec3<f32>>, s_3: ptr<function, vec3<f32>>) -> vec3<f32> {
    var param_17: vec3<f32>;
    var param_18: vec3<f32>;
    var param_19: vec3<f32>;
    var param_20: vec3<f32>;
    var param_21: vec3<f32>;
    var param_22: vec3<f32>;
    var param_23: vec3<f32>;
    var param_24: vec3<f32>;
    var param_25: f32;
    var param_26: vec3<f32>;
    var param_27: vec3<f32>;
    var param_28: f32;

    let _e279: i32 = (*mode);
    if (_e279 == 1i) {
        let _e281: vec3<f32> = (*b_3);
        let _e282: vec3<f32> = (*s_3);
        return (_e281 * _e282);
    }
    let _e284: i32 = (*mode);
    if (_e284 == 2i) {
        let _e286: vec3<f32> = (*b_3);
        let _e287: vec3<f32> = (*s_3);
        let _e289: vec3<f32> = (*b_3);
        let _e290: vec3<f32> = (*s_3);
        return ((_e286 + _e287) - (_e289 * _e290));
    }
    let _e293: i32 = (*mode);
    if (_e293 == 3i) {
        let _e295: vec3<f32> = (*s_3);
        param_17 = _e295;
        let _e296: vec3<f32> = (*b_3);
        param_18 = _e296;
        let _e297: vec3<f32> = cspHardLight_u0028_vf3_u003b_vf3_u003b((&param_17), (&param_18));
        return _e297;
    }
    let _e298: i32 = (*mode);
    if (_e298 == 4i) {
        let _e300: vec3<f32> = (*b_3);
        param_19 = _e300;
        let _e301: vec3<f32> = (*s_3);
        param_20 = _e301;
        let _e302: vec3<f32> = cspSoftLight_u0028_vf3_u003b_vf3_u003b((&param_19), (&param_20));
        return _e302;
    }
    let _e303: i32 = (*mode);
    if (_e303 == 5i) {
        let _e305: vec3<f32> = (*b_3);
        param_21 = _e305;
        let _e306: vec3<f32> = (*s_3);
        param_22 = _e306;
        let _e307: vec3<f32> = cspHardLight_u0028_vf3_u003b_vf3_u003b((&param_21), (&param_22));
        return _e307;
    }
    let _e308: i32 = (*mode);
    if (_e308 == 6i) {
        let _e310: vec3<f32> = (*b_3);
        let _e311: vec3<f32> = (*s_3);
        return min(_e310, _e311);
    }
    let _e313: i32 = (*mode);
    if (_e313 == 7i) {
        let _e315: vec3<f32> = (*b_3);
        let _e316: vec3<f32> = (*s_3);
        return max(_e315, _e316);
    }
    let _e318: i32 = (*mode);
    if (_e318 == 8i) {
        let _e320: vec3<f32> = (*b_3);
        param_23 = _e320;
        let _e321: f32 = cspLum_u0028_vf3_u003b((&param_23));
        let _e322: vec3<f32> = (*s_3);
        param_24 = _e322;
        param_25 = _e321;
        let _e323: vec3<f32> = cspSetLum_u0028_vf3_u003b_f1_u003b((&param_24), (&param_25));
        return _e323;
    }
    let _e324: i32 = (*mode);
    if (_e324 == 9i) {
        let _e326: vec3<f32> = (*s_3);
        param_26 = _e326;
        let _e327: f32 = cspLum_u0028_vf3_u003b((&param_26));
        let _e328: vec3<f32> = (*b_3);
        param_27 = _e328;
        param_28 = _e327;
        let _e329: vec3<f32> = cspSetLum_u0028_vf3_u003b_f1_u003b((&param_27), (&param_28));
        return _e329;
    }
    let _e330: vec3<f32> = (*s_3);
    return _e330;
}

fn cspComposite_u0028_vf4_u003b_vf3_u003b_f1_u003b_i1_u003b(backdrop: ptr<function, vec4<f32>>, s_4: ptr<function, vec3<f32>>, as_: ptr<function, f32>, mode_1: ptr<function, i32>) -> vec4<f32> {
    var ab: f32;
    var b_4: vec3<f32>;
    var local: vec3<f32>;
    var mixed: vec3<f32>;
    var param_29: i32;
    var param_30: vec3<f32>;
    var param_31: vec3<f32>;

    let _e276: f32 = (*backdrop)[3u];
    ab = _e276;
    let _e277: f32 = ab;
    if (_e277 > 0f) {
        let _e279: vec4<f32> = (*backdrop);
        let _e281: f32 = ab;
        local = (_e279.xyz / vec3(_e281));
    } else {
        local = vec3<f32>(0f, 0f, 0f);
    }
    let _e284: vec3<f32> = local;
    b_4 = _e284;
    let _e285: f32 = ab;
    let _e287: vec3<f32> = (*s_4);
    let _e289: f32 = ab;
    let _e290: i32 = (*mode_1);
    param_29 = _e290;
    let _e291: vec3<f32> = b_4;
    param_30 = _e291;
    let _e292: vec3<f32> = (*s_4);
    param_31 = _e292;
    let _e293: vec3<f32> = cspBlendMode_u0028_i1_u003b_vf3_u003b_vf3_u003b((&param_29), (&param_30), (&param_31));
    mixed = ((_e287 * (1f - _e285)) + (clamp(_e293, vec3(0f), vec3(1f)) * _e289));
    let _e299: f32 = (*as_);
    let _e300: vec3<f32> = mixed;
    let _e302: f32 = (*as_);
    let _e304: vec4<f32> = (*backdrop);
    let _e307: vec3<f32> = ((_e300 * _e299) + (_e304.xyz * (1f - _e302)));
    let _e308: f32 = (*as_);
    let _e309: f32 = ab;
    let _e310: f32 = (*as_);
    return vec4<f32>(_e307.x, _e307.y, _e307.z, (_e308 + (_e309 * (1f - _e310))));
}

fn cspStopPos_u0028_i1_u003b_i1_u003b(layer: ptr<function, i32>, k: ptr<function, i32>) -> f32 {
    var v: vec4<f32>;
    var m: i32;
    var local_1: f32;
    var local_2: f32;
    var local_3: f32;

    let _e271: i32 = (*layer);
    let _e273: i32 = (*k);
    let _e278: vec4<f32> = unnamed.u_layerPos[((_e271 * 3i) + (_e273 / 4i))];
    v = _e278;
    let _e279: i32 = (*k);
    let _e280: i32 = (*k);
    m = (_e279 - ((_e280 / 4i) * 4i));
    let _e284: i32 = m;
    if (_e284 == 0i) {
        let _e287: f32 = v[0u];
        local_1 = _e287;
    } else {
        let _e288: i32 = m;
        if (_e288 == 1i) {
            let _e291: f32 = v[1u];
            local_2 = _e291;
        } else {
            let _e292: i32 = m;
            if (_e292 == 2i) {
                let _e295: f32 = v[2u];
                local_3 = _e295;
            } else {
                let _e297: f32 = v[3u];
                local_3 = _e297;
            }
            let _e298: f32 = local_3;
            local_2 = _e298;
        }
        let _e299: f32 = local_2;
        local_1 = _e299;
    }
    let _e300: f32 = local_1;
    return _e300;
}

fn cspRampAt_u0028_i1_u003b_f1_u003b(layer_1: ptr<function, i32>, t_1: ptr<function, f32>) -> vec4<f32> {
    var count: i32;
    var base: i32;
    var param_32: i32;
    var param_33: i32;
    var k_1: i32;
    var p1_: f32;
    var param_34: i32;
    var param_35: i32;
    var p0_: f32;
    var param_36: i32;
    var param_37: i32;
    var phi_1586_: bool;

    let _e277: i32 = (*layer_1);
    let _e281: f32 = unnamed.u_layerA[_e277][3u];
    count = i32((_e281 + 0.5f));
    let _e284: i32 = (*layer_1);
    base = (_e284 * 10i);
    let _e286: i32 = count;
    let _e287: bool = (_e286 <= 1i);
    phi_1586_ = _e287;
    if !(_e287) {
        let _e289: f32 = (*t_1);
        let _e290: i32 = (*layer_1);
        param_32 = _e290;
        param_33 = 0i;
        let _e291: f32 = cspStopPos_u0028_i1_u003b_i1_u003b((&param_32), (&param_33));
        phi_1586_ = (_e289 <= _e291);
    }
    let _e294: bool = phi_1586_;
    if _e294 {
        let _e295: i32 = base;
        let _e298: vec4<f32> = unnamed.u_layerColors[_e295];
        return _e298;
    }
    k_1 = 1i;
    loop {
        let _e299: i32 = k_1;
        if (_e299 < 10i) {
            let _e301: i32 = k_1;
            let _e302: i32 = count;
            if (_e301 >= _e302) {
                break;
            }
            let _e304: i32 = (*layer_1);
            param_34 = _e304;
            let _e305: i32 = k_1;
            param_35 = _e305;
            let _e306: f32 = cspStopPos_u0028_i1_u003b_i1_u003b((&param_34), (&param_35));
            p1_ = _e306;
            let _e307: f32 = (*t_1);
            let _e308: f32 = p1_;
            if (_e307 <= _e308) {
                let _e310: i32 = k_1;
                let _e312: i32 = (*layer_1);
                param_36 = _e312;
                param_37 = (_e310 - 1i);
                let _e313: f32 = cspStopPos_u0028_i1_u003b_i1_u003b((&param_36), (&param_37));
                p0_ = _e313;
                let _e314: i32 = base;
                let _e315: i32 = k_1;
                let _e320: vec4<f32> = unnamed.u_layerColors[((_e314 + _e315) - 1i)];
                let _e321: i32 = base;
                let _e322: i32 = k_1;
                let _e326: vec4<f32> = unnamed.u_layerColors[(_e321 + _e322)];
                let _e327: f32 = (*t_1);
                let _e328: f32 = p0_;
                let _e330: f32 = p1_;
                let _e331: f32 = p0_;
                return mix(_e320, _e326, vec4(clamp(((_e327 - _e328) / max((_e330 - _e331), 0.000001f)), 0f, 1f)));
            }
            continue;
        } else {
            break;
        }
        continuing {
            let _e338: i32 = k_1;
            k_1 = (_e338 + 1i);
        }
    }
    let _e340: i32 = base;
    let _e341: i32 = count;
    let _e346: vec4<f32> = unnamed.u_layerColors[((_e340 + _e341) - 1i)];
    return _e346;
}

fn cspPaletteRange_u0028_i1_u003b_f1_u003b_vf2_u003b(layer_2: ptr<function, i32>, value_2: ptr<function, f32>, range: ptr<function, vec2<f32>>) -> vec4<f32> {
    var r: vec4<f32>;
    var t_2: f32;
    var param_38: i32;
    var param_39: f32;

    let _e271: i32 = (*layer_2);
    let _e274: vec4<f32> = unnamed.u_layerB[_e271];
    r = _e274;
    let _e275: f32 = (*value_2);
    let _e277: f32 = (*range)[0u];
    let _e280: f32 = (*range)[1u];
    let _e282: f32 = (*range)[0u];
    t_2 = clamp(((_e275 - _e277) / max((_e280 - _e282), 0.000001f)), 0f, 1f);
    let _e287: f32 = t_2;
    let _e290: f32 = r[2u];
    t_2 = pow(max(_e287, 0f), _e290);
    let _e293: f32 = r[3u];
    if (_e293 >= 2f) {
        let _e295: f32 = t_2;
        let _e297: f32 = r[3u];
        let _e301: f32 = r[3u];
        let _e305: f32 = r[3u];
        t_2 = (min(floor((_e295 * _e297)), (_e301 - 1f)) / (_e305 - 1f));
    }
    let _e308: i32 = (*layer_2);
    param_38 = _e308;
    let _e309: f32 = t_2;
    param_39 = _e309;
    let _e310: vec4<f32> = cspRampAt_u0028_i1_u003b_f1_u003b((&param_38), (&param_39));
    return _e310;
}

fn cspPalette_u0028_i1_u003b_f1_u003b(layer_3: ptr<function, i32>, value_3: ptr<function, f32>) -> vec4<f32> {
    var param_40: i32;
    var param_41: f32;
    var param_42: vec2<f32>;

    let _e269: i32 = (*layer_3);
    let _e270: i32 = (*layer_3);
    param_40 = _e270;
    let _e271: f32 = (*value_3);
    param_41 = _e271;
    let _e274: vec4<f32> = unnamed.u_layerB[_e269];
    param_42 = _e274.xy;
    let _e276: vec4<f32> = cspPaletteRange_u0028_i1_u003b_f1_u003b_vf2_u003b((&param_40), (&param_41), (&param_42));
    return _e276;
}

fn cspWaterColour_u0028_i1_u003b_f1_u003b_vf2_u003b(layer_4: ptr<function, i32>, value_4: ptr<function, f32>, range_1: ptr<function, vec2<f32>>) -> vec4<f32> {
    var t_3: f32;
    var r_1: vec4<f32>;
    var deep: vec3<f32>;
    var mid: vec3<f32>;
    var shallow: vec3<f32>;
    var local_4: vec3<f32>;
    var param_43: i32;
    var param_44: f32;

    let _e275: f32 = (*value_4);
    let _e277: f32 = (*range_1)[0u];
    let _e280: f32 = (*range_1)[1u];
    let _e282: f32 = (*range_1)[0u];
    t_3 = clamp(((_e275 - _e277) / max(0.000001f, (_e280 - _e282))), 0f, 1f);
    let _e287: i32 = (*layer_4);
    let _e290: vec4<f32> = unnamed.u_layerB[_e287];
    r_1 = _e290;
    let _e291: f32 = t_3;
    let _e294: f32 = r_1[2u];
    t_3 = pow(max(_e291, 0f), _e294);
    let _e297: f32 = r_1[3u];
    if (_e297 >= 2f) {
        let _e299: f32 = t_3;
        let _e301: f32 = r_1[3u];
        let _e305: f32 = r_1[3u];
        let _e309: f32 = r_1[3u];
        t_3 = (min(floor((_e299 * _e301)), (_e305 - 1f)) / (_e309 - 1f));
    }
    deep = vec3<f32>(0.011764706f, 0.015686275f, 0.36862746f);
    mid = vec3<f32>(0f, 0.46666667f, 0.7137255f);
    shallow = vec3<f32>(0.5647059f, 0.8784314f, 0.9372549f);
    let _e312: f32 = t_3;
    if (_e312 < 0.5f) {
        let _e314: vec3<f32> = deep;
        let _e315: vec3<f32> = mid;
        let _e316: f32 = t_3;
        local_4 = mix(_e314, _e315, vec3((_e316 * 2f)));
    } else {
        let _e320: vec3<f32> = mid;
        let _e321: vec3<f32> = shallow;
        let _e322: f32 = t_3;
        local_4 = mix(_e320, _e321, vec3(((_e322 - 0.5f) * 2f)));
    }
    let _e327: vec3<f32> = local_4;
    let _e328: i32 = (*layer_4);
    param_43 = _e328;
    let _e329: f32 = t_3;
    param_44 = _e329;
    let _e330: vec4<f32> = cspRampAt_u0028_i1_u003b_f1_u003b((&param_43), (&param_44));
    return vec4<f32>(_e327.x, _e327.y, _e327.z, _e330.w);
}

fn cspWaterClass_u0028_vf2_u003b(merc: ptr<function, vec2<f32>>) -> u32 {
    var latitude: f32;
    var q: vec2<i32>;
    var packed: vec4<u32>;

    let _e269: f32 = (*merc)[1u];
    latitude = degrees(atan(sinh((3.1415927f * (1f - (2f * _e269))))));
    let _e277: f32 = (*merc)[0u];
    let _e283: f32 = latitude;
    q = vec2<i32>(i32(min(16383f, floor((fract(_e277) * 16384f)))), i32(clamp(floor((((90f - _e283) / 180f) * 8192f)), 0f, 8191f)));
    let _e292: i32 = q[0u];
    let _e295: i32 = q[1u];
    let _e298: vec4<u32> = textureLoad(u_waterMask, vec2<i32>((_e292 / 8i), (_e295 / 4i)), 0i);
    packed = _e298;
    let _e300: i32 = q[1u];
    let _e309: u32 = packed[(_e300 - (i32(floor((f32(_e300) / f32(4i)))) * 4i))];
    let _e311: i32 = q[0u];
    return ((_e309 >> bitcast<u32>(bitcast<u32>((14i - (2i * (_e311 - (i32(floor((f32(_e311) / f32(8i)))) * 8i))))))) & 3u);
}

fn cspCustom32_u0028_struct_u002d_CspCtx_u002d_vi2_u002d_f1_u002d_f1_u002d_f1_u002d_f1_u002d_f1_u002d_f1_u002d_f1_u002d_f1_u002d_f11_u003b(c_4: ptr<function, CspCtx>) -> vec2<f32> {
    let _e266: f32 = (*c_4).height;
    let _e273: f32 = (*c_4).height;
    let _e275: f32 = (*c_4).height;
    return vec2<f32>(((_e266 - (floor((_e266 / 17f)) * 17f)) / 17f), select(0f, 1f, (_e273 == _e275)));
}

fn cspCustomStyle_u0028_i1_u003b_struct_u002d_CspCtx_u002d_vi2_u002d_f1_u002d_f1_u002d_f1_u002d_f1_u002d_f1_u002d_f1_u002d_f1_u002d_f1_u002d_f11_u003b(style: ptr<function, i32>, c_5: ptr<function, CspCtx>) -> vec2<f32> {
    var param_45: CspCtx;

    let _e267: i32 = (*style);
    if (_e267 == 32i) {
        let _e269: CspCtx = (*c_5);
        param_45 = _e269;
        let _e270: vec2<f32> = cspCustom32_u0028_struct_u002d_CspCtx_u002d_vi2_u002d_f1_u002d_f1_u002d_f1_u002d_f1_u002d_f1_u002d_f1_u002d_f1_u002d_f1_u002d_f11_u003b((&param_45));
        let _e271: CspCtx = param_45;
        (*c_5) = _e271;
        return _e270;
    }
    return vec2<f32>(0f, 0f);
}

fn cspMultiShade_u0028_f1_u003b_f1_u003b(dx_2: ptr<function, f32>, dy_2: ptr<function, f32>) -> f32 {
    var aspect: f32;
    var param_46: f32;
    var param_47: f32;
    var sum: f32;
    var total: f32;
    var index: i32;
    var az_1: f32;
    var s_5: f32;
    var weight: f32;
    var local_5: f32;
    var param_48: f32;
    var param_49: f32;
    var param_50: f32;

    let _e279: f32 = (*dx_2);
    param_46 = _e279;
    let _e280: f32 = (*dy_2);
    param_47 = _e280;
    let _e281: f32 = cspAspectOf_u0028_f1_u003b_f1_u003b((&param_46), (&param_47));
    aspect = _e281;
    sum = 0f;
    total = 0f;
    index = 0i;
    loop {
        let _e282: i32 = index;
        if (_e282 < 4i) {
            let _e285: f32 = unnamed.u_sunAzimuth;
            let _e287: i32 = index;
            az_1 = ((_e285 - 90f) + (45f * f32(_e287)));
            let _e291: f32 = aspect;
            let _e292: f32 = az_1;
            s_5 = sin(radians((_e291 - (_e292 - (floor((_e292 / 360f)) * 360f)))));
            let _e300: f32 = (*dx_2);
            let _e301: f32 = (*dy_2);
            if (length(vec2<f32>(_e300, _e301)) < 0.000000000001f) {
                local_5 = 1f;
            } else {
                let _e305: f32 = s_5;
                let _e306: f32 = s_5;
                local_5 = (_e305 * _e306);
            }
            let _e308: f32 = local_5;
            weight = _e308;
            let _e309: f32 = weight;
            let _e310: f32 = (*dx_2);
            param_48 = _e310;
            let _e311: f32 = (*dy_2);
            param_49 = _e311;
            let _e312: f32 = az_1;
            param_50 = _e312;
            let _e313: f32 = cspDirectShade_u0028_f1_u003b_f1_u003b_f1_u003b((&param_48), (&param_49), (&param_50));
            let _e315: f32 = sum;
            sum = (_e315 + (_e309 * _e313));
            let _e317: f32 = weight;
            let _e318: f32 = total;
            total = (_e318 + _e317);
            continue;
        } else {
            break;
        }
        continuing {
            let _e320: i32 = index;
            index = (_e320 + 1i);
        }
    }
    let _e323: f32 = unnamed.u_ambient;
    let _e325: f32 = unnamed.u_ambient;
    let _e327: f32 = sum;
    let _e329: f32 = total;
    return (_e323 + (((1f - _e325) * _e327) / max(_e329, 0.00001f)));
}

fn cspShadeAt_u0028_f1_u003b_f1_u003b_f1_u003b(dx_3: ptr<function, f32>, dy_3: ptr<function, f32>, azimuth_1: ptr<function, f32>) -> f32 {
    var param_51: f32;
    var param_52: f32;
    var param_53: f32;

    let _e271: f32 = unnamed.u_ambient;
    let _e273: f32 = unnamed.u_ambient;
    let _e275: f32 = (*dx_3);
    param_51 = _e275;
    let _e276: f32 = (*dy_3);
    param_52 = _e276;
    let _e277: f32 = (*azimuth_1);
    param_53 = _e277;
    let _e278: f32 = cspDirectShade_u0028_f1_u003b_f1_u003b_f1_u003b((&param_51), (&param_52), (&param_53));
    return (_e271 + ((1f - _e273) * _e278));
}

fn cspLayerValue_u0028_i1_u003b_f1_u003b_struct_u002d_CspCtx_u002d_vi2_u002d_f1_u002d_f1_u002d_f1_u002d_f1_u002d_f1_u002d_f1_u002d_f1_u002d_f1_u002d_f11_u003b(style_1: ptr<function, i32>, param_54: ptr<function, f32>, c_6: ptr<function, CspCtx>) -> vec2<f32> {
    var param_55: f32;
    var param_56: f32;
    var param_57: f32;
    var param_58: f32;
    var param_59: f32;
    var local_6: vec2<f32>;
    var local_7: vec2<f32>;
    var interval: f32;
    var local_8: f32;
    var local_9: f32;
    var local_10: f32;
    var local_11: f32;
    var perPixel: f32;
    var spacing: f32;
    var multiple: f32;
    var distanceToLine: f32;
    var lineWidth: f32;
    var indexLine: bool;
    var param_60: i32;
    var param_61: CspCtx;

    let _e287: i32 = (*style_1);
    if (_e287 == 0i) {
        let _e290: f32 = (*c_6).sdx;
        param_55 = _e290;
        let _e292: f32 = (*c_6).sdy;
        param_56 = _e292;
        let _e294: f32 = unnamed.u_sunAzimuth;
        param_57 = _e294;
        let _e295: f32 = cspShadeAt_u0028_f1_u003b_f1_u003b_f1_u003b((&param_55), (&param_56), (&param_57));
        return vec2<f32>(_e295, 1f);
    }
    let _e297: i32 = (*style_1);
    if (_e297 == 1i) {
        let _e300: f32 = (*c_6).sdx;
        param_58 = _e300;
        let _e302: f32 = (*c_6).sdy;
        param_59 = _e302;
        let _e303: f32 = cspMultiShade_u0028_f1_u003b_f1_u003b((&param_58), (&param_59));
        return vec2<f32>(_e303, 1f);
    }
    let _e305: i32 = (*style_1);
    if (_e305 == 2i) {
        let _e308: f32 = (*c_6).slope;
        return vec2<f32>(_e308, 1f);
    }
    let _e310: i32 = (*style_1);
    if (_e310 == 3i) {
        let _e313: f32 = (*c_6).aspect;
        if (_e313 < 0f) {
            local_6 = vec2<f32>(0f, 0f);
        } else {
            let _e316: f32 = (*c_6).aspect;
            local_6 = vec2<f32>(_e316, 1f);
        }
        let _e318: vec2<f32> = local_6;
        return _e318;
    }
    let _e319: i32 = (*style_1);
    if (_e319 == 4i) {
        let _e322: f32 = (*c_6).aspect;
        if (_e322 < 0f) {
            local_7 = vec2<f32>(0f, 0f);
        } else {
            let _e325: f32 = (*c_6).aspect;
            local_7 = vec2<f32>(cos(radians(_e325)), 1f);
        }
        let _e329: vec2<f32> = local_7;
        return _e329;
    }
    let _e330: i32 = (*style_1);
    if (_e330 == 5i) {
        let _e333: f32 = (*c_6).height;
        return vec2<f32>(_e333, 1f);
    }
    let _e335: i32 = (*style_1);
    if (_e335 == 10i) {
        let _e338: f32 = (*c_6).height;
        let _e340: f32 = (*c_6).base;
        return vec2<f32>(max(0f, (_e338 - _e340)), 1f);
    }
    let _e344: i32 = (*style_1);
    let _e346: i32 = (*style_1);
    let _e349: i32 = (*style_1);
    if (((_e344 >= 6i) && (_e346 <= 9i)) || (_e349 == 11i)) {
        let _e352: i32 = (*style_1);
        if (_e352 == 6i) {
            local_8 = 2f;
        } else {
            let _e354: i32 = (*style_1);
            if (_e354 == 7i) {
                local_9 = 5f;
            } else {
                let _e356: i32 = (*style_1);
                if (_e356 == 8i) {
                    local_10 = 10f;
                } else {
                    let _e358: i32 = (*style_1);
                    if (_e358 == 9i) {
                        local_11 = 25f;
                    } else {
                        let _e360: f32 = (*param_54);
                        local_11 = max(0.5f, _e360);
                    }
                    let _e362: f32 = local_11;
                    local_10 = _e362;
                }
                let _e363: f32 = local_10;
                local_9 = _e363;
            }
            let _e364: f32 = local_9;
            local_8 = _e364;
        }
        let _e365: f32 = local_8;
        interval = _e365;
        let _e367: f32 = (*c_6).dx;
        let _e369: f32 = (*c_6).dy;
        let _e373: f32 = (*c_6).res;
        perPixel = ((length(vec2<f32>(_e367, _e369)) * _e373) * 3.28084f);
        let _e376: f32 = perPixel;
        if (_e376 > 0f) {
            let _e378: f32 = interval;
            let _e379: f32 = perPixel;
            spacing = (_e378 / _e379);
            let _e381: f32 = spacing;
            if (_e381 < 3f) {
                let _e383: f32 = spacing;
                if ((_e383 * 5f) >= 3f) {
                    let _e386: f32 = interval;
                    interval = (_e386 * 5f);
                } else {
                    return vec2<f32>(0f, 0f);
                }
            }
        }
        let _e389: f32 = (*c_6).height;
        let _e391: f32 = interval;
        multiple = ((_e389 * 3.28084f) / _e391);
        let _e393: f32 = multiple;
        let _e394: f32 = multiple;
        let _e398: f32 = interval;
        distanceToLine = (abs((_e393 - round(_e394))) * _e398);
        let _e400: f32 = interval;
        let _e402: f32 = perPixel;
        lineWidth = max(0.35f, min((_e400 * 0.5f), (_e402 * 0.7f)));
        let _e406: f32 = distanceToLine;
        let _e407: f32 = lineWidth;
        if (_e406 >= _e407) {
            return vec2<f32>(0f, 0f);
        }
        let _e409: f32 = multiple;
        let _e410: f32 = round(_e409);
        indexLine = (abs((_e410 - (floor((_e410 / 5f)) * 5f))) < 0.5f);
        let _e417: bool = indexLine;
        return vec2<f32>(select(0f, 1f, _e417), 1f);
    }
    let _e420: i32 = (*style_1);
    if (_e420 >= 32i) {
        let _e422: i32 = (*style_1);
        param_60 = _e422;
        let _e423: CspCtx = (*c_6);
        param_61 = _e423;
        let _e424: vec2<f32> = cspCustomStyle_u0028_i1_u003b_struct_u002d_CspCtx_u002d_vi2_u002d_f1_u002d_f1_u002d_f1_u002d_f1_u002d_f1_u002d_f1_u002d_f1_u002d_f1_u002d_f11_u003b((&param_60), (&param_61));
        let _e425: CspCtx = param_61;
        (*c_6) = _e425;
        return _e424;
    }
    return vec2<f32>(0f, 0f);
}

fn csp_landBase_u0028_vi2_u003b_f1_u003b(p: ptr<function, vec2<i32>>, v_1: ptr<function, f32>) -> bool {
    var q_1: vec2<f32>;
    var b_5: vec2<i32>;
    var fr: vec2<f32>;
    var ts: vec2<i32>;
    var sum_1: f32;
    var w: f32;
    var y: i32;
    var x_1: i32;
    var a_1: vec2<f32>;
    var k_2: f32;
    var local_12: f32;
    var local_13: f32;

    (*v_1) = 0f;
    let _e279: f32 = unnamed.csk_landBaseScale;
    if (_e279 <= 0f) {
        return false;
    }
    let _e282: mat3x3<f32> = unnamed.csk_auxTransform;
    let _e283: vec2<i32> = (*p);
    let _e286: vec2<f32> = (vec2<f32>(_e283) + vec2(0.5f));
    let _e293: f32 = unnamed.csk_landBaseScale;
    q_1 = (((_e282 * vec3<f32>(_e286.x, _e286.y, 1f)).xy / vec2(_e293)) - vec2(0.5f));
    let _e298: vec2<f32> = q_1;
    b_5 = vec2<i32>(floor(_e298));
    let _e301: vec2<f32> = q_1;
    let _e302: vec2<i32> = b_5;
    fr = (_e301 - vec2<f32>(_e302));
    let _e305: vec2<u32> = textureDimensions(csk_landBase, 0i);
    ts = vec2<i32>(_e305);
    sum_1 = 0f;
    w = 0f;
    y = 0i;
    loop {
        let _e307: i32 = y;
        if (_e307 < 2i) {
            x_1 = 0i;
            loop {
                let _e309: i32 = x_1;
                if (_e309 < 2i) {
                    let _e311: vec2<i32> = b_5;
                    let _e312: i32 = x_1;
                    let _e313: i32 = y;
                    let _e316: vec2<i32> = ts;
                    let _e320: vec4<f32> = textureLoad(csk_landBase, clamp((_e311 + vec2<i32>(_e312, _e313)), vec2<i32>(0i, 0i), (_e316 - vec2(1i))), 0i);
                    a_1 = _e320.xy;
                    let _e322: i32 = x_1;
                    if (_e322 == 0i) {
                        let _e325: f32 = fr[0u];
                        local_12 = (1f - _e325);
                    } else {
                        let _e328: f32 = fr[0u];
                        local_12 = _e328;
                    }
                    let _e329: f32 = local_12;
                    let _e330: i32 = y;
                    if (_e330 == 0i) {
                        let _e333: f32 = fr[1u];
                        local_13 = (1f - _e333);
                    } else {
                        let _e336: f32 = fr[1u];
                        local_13 = _e336;
                    }
                    let _e337: f32 = local_13;
                    k_2 = (_e329 * _e337);
                    let _e340: f32 = a_1[1u];
                    let _e342: f32 = k_2;
                    if ((_e340 > 0f) && (_e342 > 0f)) {
                        let _e346: f32 = a_1[0u];
                        let _e347: f32 = k_2;
                        let _e349: f32 = sum_1;
                        sum_1 = (_e349 + (_e346 * _e347));
                        let _e351: f32 = k_2;
                        let _e352: f32 = w;
                        w = (_e352 + _e351);
                    }
                    continue;
                } else {
                    break;
                }
                continuing {
                    let _e354: i32 = x_1;
                    x_1 = (_e354 + 1i);
                }
            }
            continue;
        } else {
            break;
        }
        continuing {
            let _e356: i32 = y;
            y = (_e356 + 1i);
        }
    }
    let _e358: f32 = w;
    if (_e358 <= 0f) {
        return false;
    }
    let _e360: f32 = sum_1;
    let _e361: f32 = w;
    (*v_1) = (_e360 / _e361);
    return true;
}

fn csp_base_u0028_vi2_u003b_f1_u003b(p_1: ptr<function, vec2<i32>>, v_2: ptr<function, f32>) -> bool {
    var q_2: vec2<f32>;
    var b_6: vec2<i32>;
    var fr_1: vec2<f32>;
    var ts_1: vec2<i32>;
    var sum_2: f32;
    var w_1: f32;
    var y_1: i32;
    var x_2: i32;
    var a_2: vec2<f32>;
    var k_3: f32;
    var local_14: f32;
    var local_15: f32;

    (*v_2) = 0f;
    let _e279: f32 = unnamed.csk_baseScale;
    if (_e279 <= 0f) {
        return false;
    }
    let _e282: mat3x3<f32> = unnamed.csk_auxTransform;
    let _e283: vec2<i32> = (*p_1);
    let _e286: vec2<f32> = (vec2<f32>(_e283) + vec2(0.5f));
    let _e293: f32 = unnamed.csk_baseScale;
    q_2 = (((_e282 * vec3<f32>(_e286.x, _e286.y, 1f)).xy / vec2(_e293)) - vec2(0.5f));
    let _e298: vec2<f32> = q_2;
    b_6 = vec2<i32>(floor(_e298));
    let _e301: vec2<f32> = q_2;
    let _e302: vec2<i32> = b_6;
    fr_1 = (_e301 - vec2<f32>(_e302));
    let _e305: vec2<u32> = textureDimensions(csk_base, 0i);
    ts_1 = vec2<i32>(_e305);
    sum_2 = 0f;
    w_1 = 0f;
    y_1 = 0i;
    loop {
        let _e307: i32 = y_1;
        if (_e307 < 2i) {
            x_2 = 0i;
            loop {
                let _e309: i32 = x_2;
                if (_e309 < 2i) {
                    let _e311: vec2<i32> = b_6;
                    let _e312: i32 = x_2;
                    let _e313: i32 = y_1;
                    let _e316: vec2<i32> = ts_1;
                    let _e320: vec4<f32> = textureLoad(csk_base, clamp((_e311 + vec2<i32>(_e312, _e313)), vec2<i32>(0i, 0i), (_e316 - vec2(1i))), 0i);
                    a_2 = _e320.xy;
                    let _e322: i32 = x_2;
                    if (_e322 == 0i) {
                        let _e325: f32 = fr_1[0u];
                        local_14 = (1f - _e325);
                    } else {
                        let _e328: f32 = fr_1[0u];
                        local_14 = _e328;
                    }
                    let _e329: f32 = local_14;
                    let _e330: i32 = y_1;
                    if (_e330 == 0i) {
                        let _e333: f32 = fr_1[1u];
                        local_15 = (1f - _e333);
                    } else {
                        let _e336: f32 = fr_1[1u];
                        local_15 = _e336;
                    }
                    let _e337: f32 = local_15;
                    k_3 = (_e329 * _e337);
                    let _e340: f32 = a_2[1u];
                    let _e342: f32 = k_3;
                    if ((_e340 > 0f) && (_e342 > 0f)) {
                        let _e346: f32 = a_2[0u];
                        let _e347: f32 = k_3;
                        let _e349: f32 = sum_2;
                        sum_2 = (_e349 + (_e346 * _e347));
                        let _e351: f32 = k_3;
                        let _e352: f32 = w_1;
                        w_1 = (_e352 + _e351);
                    }
                    continue;
                } else {
                    break;
                }
                continuing {
                    let _e354: i32 = x_2;
                    x_2 = (_e354 + 1i);
                }
            }
            continue;
        } else {
            break;
        }
        continuing {
            let _e356: i32 = y_1;
            y_1 = (_e356 + 1i);
        }
    }
    let _e358: f32 = w_1;
    if (_e358 <= 0f) {
        return false;
    }
    let _e360: f32 = sum_2;
    let _e361: f32 = w_1;
    (*v_2) = (_e360 / _e361);
    return true;
}

fn csp_blur_u0028_vi2_u003b_f1_u003b(p_2: ptr<function, vec2<i32>>, v_3: ptr<function, f32>) -> bool {
    var q_3: vec2<f32>;
    var b_7: vec2<i32>;
    var fr_2: vec2<f32>;
    var ts_2: vec2<i32>;
    var sum_3: f32;
    var w_2: f32;
    var y_2: i32;
    var x_3: i32;
    var a_3: vec2<f32>;
    var k_4: f32;
    var local_16: f32;
    var local_17: f32;

    (*v_3) = 0f;
    let _e279: f32 = unnamed.csk_blurScale;
    if (_e279 <= 0f) {
        return false;
    }
    let _e282: mat3x3<f32> = unnamed.csk_auxTransform;
    let _e283: vec2<i32> = (*p_2);
    let _e286: vec2<f32> = (vec2<f32>(_e283) + vec2(0.5f));
    let _e293: f32 = unnamed.csk_blurScale;
    q_3 = (((_e282 * vec3<f32>(_e286.x, _e286.y, 1f)).xy / vec2(_e293)) - vec2(0.5f));
    let _e298: vec2<f32> = q_3;
    b_7 = vec2<i32>(floor(_e298));
    let _e301: vec2<f32> = q_3;
    let _e302: vec2<i32> = b_7;
    fr_2 = (_e301 - vec2<f32>(_e302));
    let _e305: vec2<u32> = textureDimensions(csk_blur, 0i);
    ts_2 = vec2<i32>(_e305);
    sum_3 = 0f;
    w_2 = 0f;
    y_2 = 0i;
    loop {
        let _e307: i32 = y_2;
        if (_e307 < 2i) {
            x_3 = 0i;
            loop {
                let _e309: i32 = x_3;
                if (_e309 < 2i) {
                    let _e311: vec2<i32> = b_7;
                    let _e312: i32 = x_3;
                    let _e313: i32 = y_2;
                    let _e316: vec2<i32> = ts_2;
                    let _e320: vec4<f32> = textureLoad(csk_blur, clamp((_e311 + vec2<i32>(_e312, _e313)), vec2<i32>(0i, 0i), (_e316 - vec2(1i))), 0i);
                    a_3 = _e320.xy;
                    let _e322: i32 = x_3;
                    if (_e322 == 0i) {
                        let _e325: f32 = fr_2[0u];
                        local_16 = (1f - _e325);
                    } else {
                        let _e328: f32 = fr_2[0u];
                        local_16 = _e328;
                    }
                    let _e329: f32 = local_16;
                    let _e330: i32 = y_2;
                    if (_e330 == 0i) {
                        let _e333: f32 = fr_2[1u];
                        local_17 = (1f - _e333);
                    } else {
                        let _e336: f32 = fr_2[1u];
                        local_17 = _e336;
                    }
                    let _e337: f32 = local_17;
                    k_4 = (_e329 * _e337);
                    let _e340: f32 = a_3[1u];
                    let _e342: f32 = k_4;
                    if ((_e340 > 0f) && (_e342 > 0f)) {
                        let _e346: f32 = a_3[0u];
                        let _e347: f32 = k_4;
                        let _e349: f32 = sum_3;
                        sum_3 = (_e349 + (_e346 * _e347));
                        let _e351: f32 = k_4;
                        let _e352: f32 = w_2;
                        w_2 = (_e352 + _e351);
                    }
                    continue;
                } else {
                    break;
                }
                continuing {
                    let _e354: i32 = x_3;
                    x_3 = (_e354 + 1i);
                }
            }
            continue;
        } else {
            break;
        }
        continuing {
            let _e356: i32 = y_2;
            y_2 = (_e356 + 1i);
        }
    }
    let _e358: f32 = w_2;
    if (_e358 <= 0f) {
        return false;
    }
    let _e360: f32 = sum_3;
    let _e361: f32 = w_2;
    (*v_3) = (_e360 / _e361);
    return true;
}

fn csp_size_u0028_() -> vec2<i32> {
    let _e264: vec2<u32> = textureDimensions(csk_field, 0i);
    return vec2<i32>(_e264);
}

fn csp_height_u0028_vi2_u003b(p_3: ptr<function, vec2<i32>>) -> f32 {
    let _e265: vec2<i32> = (*p_3);
    let _e266: vec2<i32> = csp_size_u0028_();
    let _e270: vec4<f32> = textureLoad(csk_field, clamp(_e265, vec2<i32>(0i, 0i), (_e266 - vec2(1i))), 0i);
    return _e270.x;
}

fn cspH_u0028_vi2_u003b(q_4: ptr<function, vec2<i32>>) -> f32 {
    var h: f32;
    var param_62: vec2<i32>;
    var b_8: f32;
    var param_63: vec2<i32>;
    var param_64: f32;
    var phi_1502_: bool;

    let _e270: vec2<i32> = (*q_4);
    param_62 = _e270;
    let _e271: f32 = csp_height_u0028_vi2_u003b((&param_62));
    h = _e271;
    let _e273: f32 = unnamed.u_detail;
    let _e274: bool = (_e273 != 0f);
    phi_1502_ = _e274;
    if _e274 {
        let _e275: vec2<i32> = (*q_4);
        param_63 = _e275;
        let _e276: bool = csp_blur_u0028_vi2_u003b_f1_u003b((&param_63), (&param_64));
        let _e277: f32 = param_64;
        b_8 = _e277;
        phi_1502_ = _e276;
    }
    let _e279: bool = phi_1502_;
    if _e279 {
        let _e281: f32 = unnamed.u_detail;
        let _e282: f32 = h;
        let _e283: f32 = b_8;
        let _e286: f32 = h;
        h = (_e286 + (_e281 * (_e282 - _e283)));
    }
    let _e288: f32 = h;
    return _e288;
}

fn csk_isinf_u0028_f1_u003b(v_4: ptr<function, f32>) -> bool {
    let _e265: f32 = (*v_4);
    return ((bitcast<u32>(_e265) & 2147483647u) == 2139095040u);
}

fn csk_isnan_u0028_f1_u003b(v_5: ptr<function, f32>) -> bool {
    let _e265: f32 = (*v_5);
    return ((bitcast<u32>(_e265) & 2147483647u) > 2139095040u);
}

fn csk_ok_u0028_f1_u003b(v_6: ptr<function, f32>) -> bool {
    var param_65: f32;
    var param_66: f32;
    var phi_246_: bool;

    let _e267: f32 = (*v_6);
    param_65 = _e267;
    let _e268: bool = csk_isnan_u0028_f1_u003b((&param_65));
    let _e269: bool = !(_e268);
    phi_246_ = _e269;
    if _e269 {
        let _e270: f32 = (*v_6);
        param_66 = _e270;
        let _e271: bool = csk_isinf_u0028_f1_u003b((&param_66));
        phi_246_ = !(_e271);
    }
    let _e274: bool = phi_246_;
    let _e275: f32 = (*v_6);
    return (_e274 && (_e275 > -100000000000000000000f));
}

fn csp_valid_u0028_vi2_u003b(p_4: ptr<function, vec2<i32>>) -> bool {
    var param_67: vec2<i32>;
    var param_68: f32;

    let _e267: vec2<i32> = (*p_4);
    param_67 = _e267;
    let _e268: f32 = csp_height_u0028_vi2_u003b((&param_67));
    param_68 = _e268;
    let _e269: bool = csk_ok_u0028_f1_u003b((&param_68));
    return _e269;
}

fn cspStack_u0028_vi2_u003b_f1_u003b_f1_u003b_f1_u003b_f1_u003b_vf2_u003b(p_5: ptr<function, vec2<i32>>, value_5: ptr<function, f32>, groundRes: ptr<function, f32>, cosB: ptr<function, f32>, sinB: ptr<function, f32>, merc_1: ptr<function, vec2<f32>>) -> vec4<f32> {
    var px: vec2<i32>;
    var py: vec2<i32>;
    var param_69: vec2<i32>;
    var param_70: vec2<i32>;
    var param_71: vec2<i32>;
    var param_72: vec2<i32>;
    var param_73: vec2<i32>;
    var param_74: vec2<i32>;
    var param_75: vec2<i32>;
    var param_76: vec2<i32>;
    var c_7: CspCtx;
    var a_4: f32;
    var param_77: vec2<i32>;
    var b_9: f32;
    var param_78: vec2<i32>;
    var cc: f32;
    var param_79: vec2<i32>;
    var d_1: f32;
    var param_80: vec2<i32>;
    var f: f32;
    var param_81: vec2<i32>;
    var g: f32;
    var param_82: vec2<i32>;
    var q_5: f32;
    var param_83: vec2<i32>;
    var k_5: f32;
    var param_84: vec2<i32>;
    var dxS: f32;
    var dyS: f32;
    var zFactor: f32;
    var local_18: f32;
    var param_85: f32;
    var param_86: f32;
    var legacyBase: f32;
    var baseValue: f32;
    var param_87: vec2<i32>;
    var param_88: f32;
    var local_19: f32;
    var landBase: f32;
    var landBaseValue: f32;
    var param_89: vec2<i32>;
    var param_90: f32;
    var local_20: f32;
    var acc: vec4<f32>;
    var i: i32;
    var layer_5: vec4<f32>;
    var style_2: i32;
    var param_91: f32;
    var flags: i32;
    var v_7: vec2<f32>;
    var param_92: i32;
    var param_93: f32;
    var param_94: CspCtx;
    var waterClass: u32;
    var local_21: u32;
    var param_95: vec2<f32>;
    var colour: vec4<f32>;
    var local_22: vec4<f32>;
    var param_96: i32;
    var param_97: f32;
    var param_98: vec2<f32>;
    var local_23: vec4<f32>;
    var param_99: i32;
    var param_100: f32;
    var param_101: vec2<f32>;
    var param_102: i32;
    var param_103: f32;
    var shade: f32;
    var param_104: f32;
    var param_105: f32;
    var param_106: f32;
    var alpha: f32;
    var param_107: vec4<f32>;
    var param_108: vec3<f32>;
    var param_109: f32;
    var param_110: i32;
    var straight_1: vec3<f32>;
    var param_111: vec3<f32>;
    var phi_2536_: bool;
    var phi_2546_: bool;
    var phi_2554_: bool;
    var phi_2562_: bool;
    var phi_2572_: bool;
    var phi_2580_: bool;
    var phi_2590_: bool;
    var phi_2881_: bool;
    var phi_2898_: bool;
    var phi_2921_: bool;

    px = vec2<i32>(1i, 0i);
    py = vec2<i32>(0i, 1i);
    let _e348: vec2<i32> = (*p_5);
    let _e349: vec2<i32> = px;
    let _e351: vec2<i32> = py;
    param_69 = ((_e348 - _e349) - _e351);
    let _e353: bool = csp_valid_u0028_vi2_u003b((&param_69));
    phi_2536_ = _e353;
    if _e353 {
        let _e354: vec2<i32> = (*p_5);
        let _e355: vec2<i32> = py;
        param_70 = (_e354 - _e355);
        let _e357: bool = csp_valid_u0028_vi2_u003b((&param_70));
        phi_2536_ = _e357;
    }
    let _e359: bool = phi_2536_;
    phi_2546_ = _e359;
    if _e359 {
        let _e360: vec2<i32> = (*p_5);
        let _e361: vec2<i32> = px;
        let _e363: vec2<i32> = py;
        param_71 = ((_e360 + _e361) - _e363);
        let _e365: bool = csp_valid_u0028_vi2_u003b((&param_71));
        phi_2546_ = _e365;
    }
    let _e367: bool = phi_2546_;
    phi_2554_ = _e367;
    if _e367 {
        let _e368: vec2<i32> = (*p_5);
        let _e369: vec2<i32> = px;
        param_72 = (_e368 - _e369);
        let _e371: bool = csp_valid_u0028_vi2_u003b((&param_72));
        phi_2554_ = _e371;
    }
    let _e373: bool = phi_2554_;
    phi_2562_ = _e373;
    if _e373 {
        let _e374: vec2<i32> = (*p_5);
        let _e375: vec2<i32> = px;
        param_73 = (_e374 + _e375);
        let _e377: bool = csp_valid_u0028_vi2_u003b((&param_73));
        phi_2562_ = _e377;
    }
    let _e379: bool = phi_2562_;
    phi_2572_ = _e379;
    if _e379 {
        let _e380: vec2<i32> = (*p_5);
        let _e381: vec2<i32> = px;
        let _e383: vec2<i32> = py;
        param_74 = ((_e380 - _e381) + _e383);
        let _e385: bool = csp_valid_u0028_vi2_u003b((&param_74));
        phi_2572_ = _e385;
    }
    let _e387: bool = phi_2572_;
    phi_2580_ = _e387;
    if _e387 {
        let _e388: vec2<i32> = (*p_5);
        let _e389: vec2<i32> = py;
        param_75 = (_e388 + _e389);
        let _e391: bool = csp_valid_u0028_vi2_u003b((&param_75));
        phi_2580_ = _e391;
    }
    let _e393: bool = phi_2580_;
    phi_2590_ = _e393;
    if _e393 {
        let _e394: vec2<i32> = (*p_5);
        let _e395: vec2<i32> = px;
        let _e397: vec2<i32> = py;
        param_76 = ((_e394 + _e395) + _e397);
        let _e399: bool = csp_valid_u0028_vi2_u003b((&param_76));
        phi_2590_ = _e399;
    }
    let _e401: bool = phi_2590_;
    if !(_e401) {
        return vec4<f32>(0f, 0f, 0f, 0f);
    }
    let _e403: vec2<i32> = (*p_5);
    c_7.p = _e403;
    let _e405: f32 = (*value_5);
    c_7.height = _e405;
    let _e407: f32 = (*groundRes);
    c_7.res = _e407;
    c_7.dx = 0f;
    c_7.dy = 0f;
    c_7.sdx = 0f;
    c_7.sdy = 0f;
    c_7.slope = 0f;
    c_7.aspect = -1f;
    let _e416: f32 = unnamed.u_stackGradient;
    if (_e416 > 0.5f) {
        let _e418: vec2<i32> = (*p_5);
        let _e419: vec2<i32> = px;
        let _e421: vec2<i32> = py;
        param_77 = ((_e418 - _e419) - _e421);
        let _e423: f32 = cspH_u0028_vi2_u003b((&param_77));
        a_4 = _e423;
        let _e424: vec2<i32> = (*p_5);
        let _e425: vec2<i32> = py;
        param_78 = (_e424 - _e425);
        let _e427: f32 = cspH_u0028_vi2_u003b((&param_78));
        b_9 = _e427;
        let _e428: vec2<i32> = (*p_5);
        let _e429: vec2<i32> = px;
        let _e431: vec2<i32> = py;
        param_79 = ((_e428 + _e429) - _e431);
        let _e433: f32 = cspH_u0028_vi2_u003b((&param_79));
        cc = _e433;
        let _e434: vec2<i32> = (*p_5);
        let _e435: vec2<i32> = px;
        param_80 = (_e434 - _e435);
        let _e437: f32 = cspH_u0028_vi2_u003b((&param_80));
        d_1 = _e437;
        let _e438: vec2<i32> = (*p_5);
        let _e439: vec2<i32> = px;
        param_81 = (_e438 + _e439);
        let _e441: f32 = cspH_u0028_vi2_u003b((&param_81));
        f = _e441;
        let _e442: vec2<i32> = (*p_5);
        let _e443: vec2<i32> = px;
        let _e445: vec2<i32> = py;
        param_82 = ((_e442 - _e443) + _e445);
        let _e447: f32 = cspH_u0028_vi2_u003b((&param_82));
        g = _e447;
        let _e448: vec2<i32> = (*p_5);
        let _e449: vec2<i32> = py;
        param_83 = (_e448 + _e449);
        let _e451: f32 = cspH_u0028_vi2_u003b((&param_83));
        q_5 = _e451;
        let _e452: vec2<i32> = (*p_5);
        let _e453: vec2<i32> = px;
        let _e455: vec2<i32> = py;
        param_84 = ((_e452 + _e453) + _e455);
        let _e457: f32 = cspH_u0028_vi2_u003b((&param_84));
        k_5 = _e457;
        let _e458: f32 = cc;
        let _e459: f32 = f;
        let _e462: f32 = k_5;
        let _e464: f32 = a_4;
        let _e465: f32 = d_1;
        let _e468: f32 = g;
        let _e471: f32 = (*groundRes);
        dxS = ((((_e458 + (2f * _e459)) + _e462) - ((_e464 + (2f * _e465)) + _e468)) / (8f * _e471));
        let _e474: f32 = g;
        let _e475: f32 = q_5;
        let _e478: f32 = k_5;
        let _e480: f32 = a_4;
        let _e481: f32 = b_9;
        let _e484: f32 = cc;
        let _e487: f32 = (*groundRes);
        dyS = ((((_e474 + (2f * _e475)) + _e478) - ((_e480 + (2f * _e481)) + _e484)) / (8f * _e487));
        let _e490: f32 = dxS;
        let _e491: f32 = (*cosB);
        let _e493: f32 = dyS;
        let _e494: f32 = (*sinB);
        c_7.dx = ((_e490 * _e491) + (_e493 * _e494));
        let _e498: f32 = dxS;
        let _e499: f32 = (*sinB);
        let _e501: f32 = dyS;
        let _e502: f32 = (*cosB);
        c_7.dy = -(((_e498 * _e499) - (_e501 * _e502)));
        let _e507: f32 = (*groundRes);
        zFactor = (1f + (0.024f * pow(max(_e507, 0f), 0.664f)));
        let _e513: f32 = c_7.dx;
        let _e514: f32 = zFactor;
        let _e517: f32 = unnamed.u_reliefExag;
        c_7.sdx = ((_e513 * _e514) * _e517);
        let _e521: f32 = c_7.dy;
        let _e522: f32 = zFactor;
        let _e525: f32 = unnamed.u_reliefExag;
        c_7.sdy = ((_e521 * _e522) * _e525);
        let _e529: f32 = c_7.dx;
        let _e531: f32 = c_7.dy;
        c_7.slope = degrees(atan(length(vec2<f32>(_e529, _e531))));
        let _e538: f32 = c_7.dx;
        let _e540: f32 = c_7.dy;
        if (length(vec2<f32>(_e538, _e540)) <= 0.008726868f) {
            local_18 = -1f;
        } else {
            let _e545: f32 = c_7.dx;
            param_85 = _e545;
            let _e547: f32 = c_7.dy;
            param_86 = _e547;
            let _e548: f32 = cspAspectOf_u0028_f1_u003b_f1_u003b((&param_85), (&param_86));
            local_18 = _e548;
        }
        let _e549: f32 = local_18;
        c_7.aspect = _e549;
    }
    let _e551: vec2<i32> = (*p_5);
    param_87 = _e551;
    let _e552: bool = csp_base_u0028_vi2_u003b_f1_u003b((&param_87), (&param_88));
    let _e553: f32 = param_88;
    baseValue = _e553;
    if _e552 {
        let _e554: f32 = baseValue;
        local_19 = _e554;
    } else {
        let _e556: f32 = unnamed.u_remFlatBase;
        local_19 = _e556;
    }
    let _e557: f32 = local_19;
    legacyBase = _e557;
    let _e558: vec2<i32> = (*p_5);
    param_89 = _e558;
    let _e559: bool = csp_landBase_u0028_vi2_u003b_f1_u003b((&param_89), (&param_90));
    let _e560: f32 = param_90;
    landBaseValue = _e560;
    if _e559 {
        let _e561: f32 = landBaseValue;
        local_20 = _e561;
    } else {
        let _e563: f32 = unnamed.u_remLandBase;
        local_20 = _e563;
    }
    let _e564: f32 = local_20;
    landBase = _e564;
    acc = vec4<f32>(0f, 0f, 0f, 0f);
    i = 0i;
    loop {
        let _e565: i32 = i;
        if (_e565 < 4i) {
            let _e567: i32 = i;
            let _e570: f32 = unnamed.u_layerCount;
            if (f32(_e567) >= _e570) {
                break;
            }
            let _e572: i32 = i;
            let _e575: vec4<f32> = unnamed.u_layerA[_e572];
            layer_5 = _e575;
            let _e577: f32 = layer_5[0u];
            style_2 = i32((_e577 + 0.5f));
            let _e580: i32 = i;
            let _e584: f32 = unnamed.u_layerC[_e580][0u];
            param_91 = _e584;
            let _e585: i32 = i;
            let _e589: f32 = unnamed.u_layerC[_e585][1u];
            flags = i32((_e589 + 0.5f));
            let _e592: i32 = flags;
            let _e595: f32 = landBase;
            let _e596: f32 = legacyBase;
            c_7.base = select(_e596, _e595, ((_e592 & 2i) != 0i));
            let _e599: i32 = style_2;
            param_92 = _e599;
            let _e600: f32 = param_91;
            param_93 = _e600;
            let _e601: CspCtx = c_7;
            param_94 = _e601;
            let _e602: vec2<f32> = cspLayerValue_u0028_i1_u003b_f1_u003b_struct_u002d_CspCtx_u002d_vi2_u002d_f1_u002d_f1_u002d_f1_u002d_f1_u002d_f1_u002d_f1_u002d_f1_u002d_f1_u002d_f11_u003b((&param_92), (&param_93), (&param_94));
            let _e603: CspCtx = param_94;
            c_7 = _e603;
            v_7 = _e602;
            let _e605: f32 = v_7[1u];
            if (_e605 <= 0f) {
                continue;
            }
            let _e607: i32 = style_2;
            let _e609: i32 = style_2;
            let _e611: bool = ((_e607 == 5i) || (_e609 == 10i));
            phi_2881_ = _e611;
            if _e611 {
                let _e612: i32 = flags;
                phi_2881_ = ((_e612 & 5i) != 0i);
            }
            let _e616: bool = phi_2881_;
            if _e616 {
                let _e617: vec2<f32> = (*merc_1);
                param_95 = _e617;
                let _e618: u32 = cspWaterClass_u0028_vf2_u003b((&param_95));
                local_21 = _e618;
            } else {
                local_21 = 0u;
            }
            let _e619: u32 = local_21;
            waterClass = _e619;
            let _e620: u32 = waterClass;
            let _e621: bool = (_e620 == 1u);
            phi_2898_ = _e621;
            if _e621 {
                let _e622: i32 = flags;
                phi_2898_ = ((_e622 & 1i) != 0i);
            }
            let _e626: bool = phi_2898_;
            if _e626 {
                let _e627: i32 = i;
                let _e628: i32 = i;
                param_96 = _e628;
                let _e630: f32 = c_7.height;
                param_97 = _e630;
                let _e633: vec4<f32> = unnamed.u_layerC[_e627];
                param_98 = _e633.zw;
                let _e635: vec4<f32> = cspWaterColour_u0028_i1_u003b_f1_u003b_vf2_u003b((&param_96), (&param_97), (&param_98));
                local_22 = _e635;
            } else {
                let _e636: u32 = waterClass;
                let _e637: bool = (_e636 == 2u);
                phi_2921_ = _e637;
                if _e637 {
                    let _e638: i32 = flags;
                    phi_2921_ = ((_e638 & 4i) != 0i);
                }
                let _e642: bool = phi_2921_;
                if _e642 {
                    let _e643: i32 = i;
                    let _e644: i32 = i;
                    param_99 = _e644;
                    let _e646: f32 = c_7.height;
                    param_100 = _e646;
                    let _e649: vec4<f32> = unnamed.u_layerD[_e643];
                    param_101 = _e649.xy;
                    let _e651: vec4<f32> = cspPaletteRange_u0028_i1_u003b_f1_u003b_vf2_u003b((&param_99), (&param_100), (&param_101));
                    local_23 = _e651;
                } else {
                    let _e652: i32 = i;
                    param_102 = _e652;
                    let _e654: f32 = v_7[0u];
                    param_103 = _e654;
                    let _e655: vec4<f32> = cspPalette_u0028_i1_u003b_f1_u003b((&param_102), (&param_103));
                    local_23 = _e655;
                }
                let _e656: vec4<f32> = local_23;
                local_22 = _e656;
            }
            let _e657: vec4<f32> = local_22;
            colour = _e657;
            let _e658: i32 = style_2;
            let _e660: i32 = style_2;
            let _e663: f32 = param_91;
            if (((_e658 == 5i) || (_e660 == 10i)) && (_e663 > 0f)) {
                let _e667: f32 = unnamed.u_ambient;
                let _e669: f32 = unnamed.u_ambient;
                let _e672: f32 = c_7.sdx;
                param_104 = _e672;
                let _e674: f32 = c_7.sdy;
                param_105 = _e674;
                let _e676: f32 = unnamed.u_sunAzimuth;
                param_106 = _e676;
                let _e677: f32 = cspDirectShade_u0028_f1_u003b_f1_u003b_f1_u003b((&param_104), (&param_105), (&param_106));
                shade = (_e667 + ((1f - _e669) * _e677));
                let _e680: vec4<f32> = colour;
                let _e682: f32 = shade;
                let _e685: f32 = param_91;
                let _e689: vec3<f32> = min((_e680.xyz * mix(1f, (0.33f + (0.82f * _e682)), clamp(_e685, 0f, 1f))), vec3<f32>(1f, 1f, 1f));
                colour[0u] = _e689.x;
                colour[1u] = _e689.y;
                colour[2u] = _e689.z;
            }
            let _e697: f32 = colour[3u];
            let _e699: f32 = v_7[1u];
            let _e702: f32 = layer_5[1u];
            alpha = clamp(((_e697 * _e699) * _e702), 0f, 1f);
            let _e705: f32 = alpha;
            if (_e705 <= 0f) {
                continue;
            }
            let _e708: f32 = layer_5[2u];
            let _e711: vec4<f32> = acc;
            param_107 = _e711;
            let _e712: vec4<f32> = colour;
            param_108 = _e712.xyz;
            let _e714: f32 = alpha;
            param_109 = _e714;
            param_110 = i32((_e708 + 0.5f));
            let _e715: vec4<f32> = cspComposite_u0028_vf4_u003b_vf3_u003b_f1_u003b_i1_u003b((&param_107), (&param_108), (&param_109), (&param_110));
            acc = _e715;
            continue;
        } else {
            break;
        }
        continuing {
            let _e716: i32 = i;
            i = (_e716 + 1i);
        }
    }
    let _e719: f32 = acc[3u];
    if (_e719 <= 0f) {
        return vec4<f32>(0f, 0f, 0f, 0f);
    }
    let _e721: vec4<f32> = acc;
    let _e724: f32 = acc[3u];
    param_111 = (_e721.xyz / vec3(_e724));
    let _e727: vec3<f32> = cspApplyAppearance_u0028_vf3_u003b((&param_111));
    straight_1 = _e727;
    let _e728: vec3<f32> = straight_1;
    let _e730: f32 = acc[3u];
    let _e731: vec3<f32> = (_e728 * _e730);
    let _e733: f32 = acc[3u];
    let _e739: f32 = unnamed.u_terrainOpacity;
    return (vec4<f32>(_e731.x, _e731.y, _e731.z, _e733) * _e739);
}

fn cspSpectrumColour_u0028_f1_u003b(value_6: ptr<function, f32>) -> vec4<f32> {
    var result: vec4<f32>;
    var d_2: f32;
    var t_4: f32;
    var blend: f32;
    var white: vec3<f32>;
    var target_: vec3<f32>;
    var local_24: vec3<f32>;
    var rgb: vec3<f32>;
    var a_5: f32;
    var belowCoverage: f32;
    var local_25: f32;
    var aboveCoverage: f32;
    var local_26: f32;
    var a_6: f32;
    var a_7: f32;
    var line: f32;
    var a_8: f32;

    result = vec4<f32>(0f, 0f, 0f, 0f);
    let _e283: f32 = unnamed.u_spectrumOn;
    if (_e283 > 0.5f) {
        let _e285: f32 = (*value_6);
        let _e287: f32 = unnamed.u_spectrumLevel;
        let _e290: f32 = unnamed.u_spectrumSpan;
        d_2 = ((_e285 - _e287) / max(1f, _e290));
        let _e293: f32 = d_2;
        t_4 = clamp(abs(_e293), 0f, 1f);
        let _e296: f32 = t_4;
        let _e297: f32 = t_4;
        let _e299: f32 = t_4;
        blend = ((_e296 * _e297) * (3f - (2f * _e299)));
        let _e304: vec3<f32> = unnamed.u_spectrumMid;
        white = _e304;
        let _e305: f32 = d_2;
        if (_e305 >= 0f) {
            let _e308: vec3<f32> = unnamed.u_spectrumHigh;
            local_24 = _e308;
        } else {
            let _e310: vec3<f32> = unnamed.u_spectrumLow;
            local_24 = _e310;
        }
        let _e311: vec3<f32> = local_24;
        target_ = _e311;
        let _e312: vec3<f32> = white;
        let _e313: vec3<f32> = target_;
        let _e314: f32 = blend;
        rgb = mix(_e312, _e313, vec3(_e314));
        let _e318: f32 = unnamed.u_spectrumAlpha;
        let _e319: f32 = t_4;
        a_5 = clamp((_e318 * (0.15f + (0.85f * _e319))), 0f, 1f);
        let _e324: vec3<f32> = rgb;
        let _e325: f32 = a_5;
        let _e327: vec4<f32> = result;
        let _e329: f32 = a_5;
        let _e332: vec3<f32> = ((_e324 * _e325) + (_e327.xyz * (1f - _e329)));
        let _e333: f32 = a_5;
        let _e335: f32 = result[3u];
        let _e336: f32 = a_5;
        result = vec4<f32>(_e332.x, _e332.y, _e332.z, (_e333 + (_e335 * (1f - _e336))));
    }
    let _e345: f32 = unnamed.u_bandFeather;
    if (_e345 > 0f) {
        let _e348: f32 = unnamed.u_belowLevel;
        let _e350: f32 = unnamed.u_bandFeather;
        let _e354: f32 = unnamed.u_belowLevel;
        let _e356: f32 = unnamed.u_bandFeather;
        let _e359: f32 = (*value_6);
        local_25 = (1f - smoothstep((_e348 - (_e350 * 0.5f)), (_e354 + (_e356 * 0.5f)), _e359));
    } else {
        let _e362: f32 = (*value_6);
        let _e364: f32 = unnamed.u_belowLevel;
        local_25 = step(_e362, _e364);
    }
    let _e366: f32 = local_25;
    belowCoverage = _e366;
    let _e368: f32 = unnamed.u_bandFeather;
    if (_e368 > 0f) {
        let _e371: f32 = unnamed.u_aboveLevel;
        let _e373: f32 = unnamed.u_bandFeather;
        let _e377: f32 = unnamed.u_aboveLevel;
        let _e379: f32 = unnamed.u_bandFeather;
        let _e382: f32 = (*value_6);
        local_26 = smoothstep((_e371 - (_e373 * 0.5f)), (_e377 + (_e379 * 0.5f)), _e382);
    } else {
        let _e385: f32 = unnamed.u_aboveLevel;
        let _e386: f32 = (*value_6);
        local_26 = step(_e385, _e386);
    }
    let _e388: f32 = local_26;
    aboveCoverage = _e388;
    let _e390: f32 = unnamed.u_belowOn;
    if (_e390 > 0.5f) {
        let _e393: f32 = unnamed.u_bandAlpha;
        let _e394: f32 = belowCoverage;
        a_6 = clamp((_e393 * _e394), 0f, 1f);
        let _e398: vec3<f32> = unnamed.u_belowColor;
        let _e399: f32 = a_6;
        let _e401: vec4<f32> = result;
        let _e403: f32 = a_6;
        let _e406: vec3<f32> = ((_e398 * _e399) + (_e401.xyz * (1f - _e403)));
        let _e407: f32 = a_6;
        let _e409: f32 = result[3u];
        let _e410: f32 = a_6;
        result = vec4<f32>(_e406.x, _e406.y, _e406.z, (_e407 + (_e409 * (1f - _e410))));
    }
    let _e419: f32 = unnamed.u_aboveOn;
    if (_e419 > 0.5f) {
        let _e422: f32 = unnamed.u_bandAlpha;
        let _e423: f32 = aboveCoverage;
        a_7 = clamp((_e422 * _e423), 0f, 1f);
        let _e427: vec3<f32> = unnamed.u_aboveColor;
        let _e428: f32 = a_7;
        let _e430: vec4<f32> = result;
        let _e432: f32 = a_7;
        let _e435: vec3<f32> = ((_e427 * _e428) + (_e430.xyz * (1f - _e432)));
        let _e436: f32 = a_7;
        let _e438: f32 = result[3u];
        let _e439: f32 = a_7;
        result = vec4<f32>(_e435.x, _e435.y, _e435.z, (_e436 + (_e438 * (1f - _e439))));
    }
    let _e448: f32 = unnamed.u_outlineOn;
    if (_e448 > 0.5f) {
        line = 0f;
        let _e451: f32 = unnamed.u_belowOn;
        if (_e451 > 0.5f) {
            let _e453: f32 = line;
            let _e455: f32 = unnamed.u_outlineWidth;
            let _e458: f32 = (*value_6);
            let _e460: f32 = unnamed.u_belowLevel;
            line = max(_e453, (1f - smoothstep(0f, max(0.001f, (_e455 * 0.5f)), abs((_e458 - _e460)))));
        }
        let _e467: f32 = unnamed.u_aboveOn;
        if (_e467 > 0.5f) {
            let _e469: f32 = line;
            let _e471: f32 = unnamed.u_outlineWidth;
            let _e474: f32 = (*value_6);
            let _e476: f32 = unnamed.u_aboveLevel;
            line = max(_e469, (1f - smoothstep(0f, max(0.001f, (_e471 * 0.5f)), abs((_e474 - _e476)))));
        }
        let _e482: f32 = line;
        a_8 = clamp((0.88f * _e482), 0f, 1f);
        let _e485: f32 = a_8;
        let _e487: vec4<f32> = result;
        let _e489: f32 = a_8;
        let _e492: vec3<f32> = ((vec3<f32>(1f, 1f, 1f) * _e485) + (_e487.xyz * (1f - _e489)));
        let _e493: f32 = a_8;
        let _e495: f32 = result[3u];
        let _e496: f32 = a_8;
        result = vec4<f32>(_e492.x, _e492.y, _e492.z, (_e493 + (_e495 * (1f - _e496))));
    }
    let _e504: vec4<f32> = result;
    return _e504;
}

fn main_1() {
    var size: vec2<i32>;
    var p_6: vec2<i32>;
    var param_112: vec2<i32>;
    var value_7: f32;
    var param_113: vec2<i32>;
    var cssOffset: vec2<f32>;
    var cosB_1: f32;
    var sinB_1: f32;
    var worldCss: f32;
    var merc_2: vec2<f32>;
    var lat: f32;
    var mpp: f32;
    var groundRes_1: f32;
    var local_27: f32;
    var spectrum: vec4<f32>;
    var param_114: f32;
    var terrain: vec4<f32>;
    var param_115: vec2<i32>;
    var param_116: f32;
    var param_117: f32;
    var param_118: f32;
    var param_119: f32;
    var param_120: vec2<f32>;
    var px_1: vec2<i32>;
    var py_1: vec2<i32>;
    var allValid: bool;
    var param_121: vec2<i32>;
    var param_122: vec2<i32>;
    var param_123: vec2<i32>;
    var param_124: vec2<i32>;
    var param_125: vec2<i32>;
    var param_126: vec2<i32>;
    var param_127: vec2<i32>;
    var param_128: vec2<i32>;
    var a_9: f32;
    var param_129: vec2<i32>;
    var b_10: f32;
    var param_130: vec2<i32>;
    var c_8: f32;
    var param_131: vec2<i32>;
    var d_3: f32;
    var param_132: vec2<i32>;
    var f_1: f32;
    var param_133: vec2<i32>;
    var g_1: f32;
    var param_134: vec2<i32>;
    var q_6: f32;
    var param_135: vec2<i32>;
    var k_6: f32;
    var param_136: vec2<i32>;
    var shaded: bool;
    var zFactor_1: f32;
    var res: f32;
    var local_28: f32;
    var dxS_1: f32;
    var dyS_1: f32;
    var dx_4: f32;
    var north_1: f32;
    var dy_4: f32;
    var colour_1: vec4<f32>;
    var painted: bool;
    var param_137: f32;
    var param_138: f32;
    var param_139: f32;
    var param_140: f32;
    var northness: f32;
    var param_141: f32;
    var param_142: f32;
    var amount: f32;
    var neutral: vec3<f32>;
    var target_1: vec3<f32>;
    var interval_1: f32;
    var local_29: f32;
    var local_30: f32;
    var perPixel_1: f32;
    var spacing_1: f32;
    var multiple_1: f32;
    var distanceToLine_1: f32;
    var lineWidth_1: f32;
    var indexLine_1: bool;
    var shade_1: f32;
    var param_143: f32;
    var param_144: f32;
    var param_145: f32;
    var param_146: f32;
    var aspect_1: f32;
    var param_147: f32;
    var param_148: f32;
    var sum_4: f32;
    var total_1: f32;
    var index_1: i32;
    var az_2: f32;
    var s_6: f32;
    var weight_1: f32;
    var local_31: f32;
    var param_149: f32;
    var param_150: f32;
    var param_151: f32;
    var direct: f32;
    var shade_2: f32;
    var direct_1: f32;
    var param_152: f32;
    var param_153: f32;
    var param_154: f32;
    var shade_3: f32;
    var straight_2: vec3<f32>;
    var local_32: vec3<f32>;
    var param_155: vec3<f32>;
    var phi_3222_: bool;
    var phi_3232_: bool;
    var phi_3240_: bool;
    var phi_3248_: bool;
    var phi_3258_: bool;
    var phi_3266_: bool;
    var phi_3276_: bool;
    var phi_3346_: bool;
    var phi_3353_: bool;

    let _e372: vec2<i32> = csp_size_u0028_();
    size = _e372;
    let _e373: vec2<f32> = v_screenUv_1;
    let _e374: vec2<i32> = size;
    let _e379: vec2<i32> = size;
    p_6 = clamp(vec2<i32>(floor((_e373 * vec2<f32>(_e374)))), vec2<i32>(0i, 0i), (_e379 - vec2<i32>(1i, 1i)));
    let _e382: vec2<i32> = p_6;
    param_112 = _e382;
    let _e383: bool = csp_valid_u0028_vi2_u003b((&param_112));
    if !(_e383) {
        fragColor = vec4<f32>(0f, 0f, 0f, 0f);
        return;
    }
    let _e385: vec2<i32> = p_6;
    param_113 = _e385;
    let _e386: f32 = csp_height_u0028_vi2_u003b((&param_113));
    value_7 = _e386;
    let _e387: vec2<f32> = v_screenUv_1;
    let _e391: vec2<f32> = unnamed.u_cssSize;
    cssOffset = ((_e387 - vec2(0.5f)) * _e391);
    let _e394: f32 = unnamed.u_bearingRad;
    cosB_1 = cos(_e394);
    let _e397: f32 = unnamed.u_bearingRad;
    sinB_1 = sin(_e397);
    let _e400: f32 = unnamed.u_zoom;
    worldCss = (256f * exp2(_e400));
    let _e404: vec2<f32> = unnamed.u_centerMerc;
    let _e406: f32 = cssOffset[0u];
    let _e407: f32 = cosB_1;
    let _e410: f32 = cssOffset[1u];
    let _e411: f32 = sinB_1;
    let _e415: f32 = cssOffset[0u];
    let _e417: f32 = sinB_1;
    let _e420: f32 = cssOffset[1u];
    let _e421: f32 = cosB_1;
    let _e425: f32 = worldCss;
    merc_2 = (_e404 + (vec2<f32>(((_e406 * _e407) + (_e410 * _e411)), ((-(_e415) * _e417) + (_e420 * _e421))) / vec2(_e425)));
    let _e430: f32 = merc_2[1u];
    lat = atan(sinh((3.1415927f * (1f - (2f * _e430)))));
    let _e436: f32 = lat;
    let _e440: f32 = unnamed.u_zoom;
    let _e444: f32 = unnamed.u_dpr;
    mpp = ((40075016f * cos(_e436)) / ((256f * exp2(_e440)) * _e444));
    let _e448: f32 = unnamed.u_groundResOverride;
    if (_e448 > 0f) {
        let _e451: f32 = unnamed.u_groundResOverride;
        local_27 = _e451;
    } else {
        let _e452: f32 = mpp;
        local_27 = _e452;
    }
    let _e453: f32 = local_27;
    groundRes_1 = _e453;
    let _e454: f32 = value_7;
    param_114 = _e454;
    let _e455: vec4<f32> = cspSpectrumColour_u0028_f1_u003b((&param_114));
    let _e457: f32 = unnamed.u_spectrumOpacity;
    spectrum = (_e455 * _e457);
    terrain = vec4<f32>(0f, 0f, 0f, 0f);
    let _e460: f32 = unnamed.u_stackOn;
    if (_e460 > 0.5f) {
        let _e462: vec2<i32> = p_6;
        param_115 = _e462;
        let _e463: f32 = value_7;
        param_116 = _e463;
        let _e464: f32 = groundRes_1;
        param_117 = _e464;
        let _e465: f32 = cosB_1;
        param_118 = _e465;
        let _e466: f32 = sinB_1;
        param_119 = _e466;
        let _e467: vec2<f32> = merc_2;
        param_120 = _e467;
        let _e468: vec4<f32> = cspStack_u0028_vi2_u003b_f1_u003b_f1_u003b_f1_u003b_f1_u003b_vf2_u003b((&param_115), (&param_116), (&param_117), (&param_118), (&param_119), (&param_120));
        terrain = _e468;
    } else {
        let _e470: i32 = unnamed.u_style;
        if (_e470 >= 0i) {
            px_1 = vec2<i32>(1i, 0i);
            py_1 = vec2<i32>(0i, 1i);
            let _e472: vec2<i32> = p_6;
            let _e473: vec2<i32> = px_1;
            let _e475: vec2<i32> = py_1;
            param_121 = ((_e472 - _e473) - _e475);
            let _e477: bool = csp_valid_u0028_vi2_u003b((&param_121));
            phi_3222_ = _e477;
            if _e477 {
                let _e478: vec2<i32> = p_6;
                let _e479: vec2<i32> = py_1;
                param_122 = (_e478 - _e479);
                let _e481: bool = csp_valid_u0028_vi2_u003b((&param_122));
                phi_3222_ = _e481;
            }
            let _e483: bool = phi_3222_;
            phi_3232_ = _e483;
            if _e483 {
                let _e484: vec2<i32> = p_6;
                let _e485: vec2<i32> = px_1;
                let _e487: vec2<i32> = py_1;
                param_123 = ((_e484 + _e485) - _e487);
                let _e489: bool = csp_valid_u0028_vi2_u003b((&param_123));
                phi_3232_ = _e489;
            }
            let _e491: bool = phi_3232_;
            phi_3240_ = _e491;
            if _e491 {
                let _e492: vec2<i32> = p_6;
                let _e493: vec2<i32> = px_1;
                param_124 = (_e492 - _e493);
                let _e495: bool = csp_valid_u0028_vi2_u003b((&param_124));
                phi_3240_ = _e495;
            }
            let _e497: bool = phi_3240_;
            phi_3248_ = _e497;
            if _e497 {
                let _e498: vec2<i32> = p_6;
                let _e499: vec2<i32> = px_1;
                param_125 = (_e498 + _e499);
                let _e501: bool = csp_valid_u0028_vi2_u003b((&param_125));
                phi_3248_ = _e501;
            }
            let _e503: bool = phi_3248_;
            phi_3258_ = _e503;
            if _e503 {
                let _e504: vec2<i32> = p_6;
                let _e505: vec2<i32> = px_1;
                let _e507: vec2<i32> = py_1;
                param_126 = ((_e504 - _e505) + _e507);
                let _e509: bool = csp_valid_u0028_vi2_u003b((&param_126));
                phi_3258_ = _e509;
            }
            let _e511: bool = phi_3258_;
            phi_3266_ = _e511;
            if _e511 {
                let _e512: vec2<i32> = p_6;
                let _e513: vec2<i32> = py_1;
                param_127 = (_e512 + _e513);
                let _e515: bool = csp_valid_u0028_vi2_u003b((&param_127));
                phi_3266_ = _e515;
            }
            let _e517: bool = phi_3266_;
            phi_3276_ = _e517;
            if _e517 {
                let _e518: vec2<i32> = p_6;
                let _e519: vec2<i32> = px_1;
                let _e521: vec2<i32> = py_1;
                param_128 = ((_e518 + _e519) + _e521);
                let _e523: bool = csp_valid_u0028_vi2_u003b((&param_128));
                phi_3276_ = _e523;
            }
            let _e525: bool = phi_3276_;
            allValid = _e525;
            let _e526: bool = allValid;
            if _e526 {
                let _e527: vec2<i32> = p_6;
                let _e528: vec2<i32> = px_1;
                let _e530: vec2<i32> = py_1;
                param_129 = ((_e527 - _e528) - _e530);
                let _e532: f32 = csp_height_u0028_vi2_u003b((&param_129));
                a_9 = _e532;
                let _e533: vec2<i32> = p_6;
                let _e534: vec2<i32> = py_1;
                param_130 = (_e533 - _e534);
                let _e536: f32 = csp_height_u0028_vi2_u003b((&param_130));
                b_10 = _e536;
                let _e537: vec2<i32> = p_6;
                let _e538: vec2<i32> = px_1;
                let _e540: vec2<i32> = py_1;
                param_131 = ((_e537 + _e538) - _e540);
                let _e542: f32 = csp_height_u0028_vi2_u003b((&param_131));
                c_8 = _e542;
                let _e543: vec2<i32> = p_6;
                let _e544: vec2<i32> = px_1;
                param_132 = (_e543 - _e544);
                let _e546: f32 = csp_height_u0028_vi2_u003b((&param_132));
                d_3 = _e546;
                let _e547: vec2<i32> = p_6;
                let _e548: vec2<i32> = px_1;
                param_133 = (_e547 + _e548);
                let _e550: f32 = csp_height_u0028_vi2_u003b((&param_133));
                f_1 = _e550;
                let _e551: vec2<i32> = p_6;
                let _e552: vec2<i32> = px_1;
                let _e554: vec2<i32> = py_1;
                param_134 = ((_e551 - _e552) + _e554);
                let _e556: f32 = csp_height_u0028_vi2_u003b((&param_134));
                g_1 = _e556;
                let _e557: vec2<i32> = p_6;
                let _e558: vec2<i32> = py_1;
                param_135 = (_e557 + _e558);
                let _e560: f32 = csp_height_u0028_vi2_u003b((&param_135));
                q_6 = _e560;
                let _e561: vec2<i32> = p_6;
                let _e562: vec2<i32> = px_1;
                let _e564: vec2<i32> = py_1;
                param_136 = ((_e561 + _e562) + _e564);
                let _e566: f32 = csp_height_u0028_vi2_u003b((&param_136));
                k_6 = _e566;
                let _e568: i32 = unnamed.u_style;
                let _e569: bool = (_e568 == 0i);
                phi_3346_ = _e569;
                if !(_e569) {
                    let _e572: i32 = unnamed.u_style;
                    phi_3346_ = (_e572 == 1i);
                }
                let _e575: bool = phi_3346_;
                phi_3353_ = _e575;
                if !(_e575) {
                    let _e578: i32 = unnamed.u_style;
                    phi_3353_ = (_e578 == 5i);
                }
                let _e581: bool = phi_3353_;
                shaded = _e581;
                let _e582: f32 = groundRes_1;
                zFactor_1 = (1f + (0.024f * pow(max(_e582, 0f), 0.664f)));
                let _e587: bool = shaded;
                if _e587 {
                    let _e588: f32 = groundRes_1;
                    let _e589: f32 = zFactor_1;
                    local_28 = (_e588 / _e589);
                } else {
                    let _e591: f32 = groundRes_1;
                    local_28 = _e591;
                }
                let _e592: f32 = local_28;
                res = _e592;
                let _e593: f32 = c_8;
                let _e594: f32 = f_1;
                let _e597: f32 = k_6;
                let _e599: f32 = a_9;
                let _e600: f32 = d_3;
                let _e603: f32 = g_1;
                let _e606: f32 = res;
                dxS_1 = ((((_e593 + (2f * _e594)) + _e597) - ((_e599 + (2f * _e600)) + _e603)) / (8f * _e606));
                let _e609: f32 = g_1;
                let _e610: f32 = q_6;
                let _e613: f32 = k_6;
                let _e615: f32 = a_9;
                let _e616: f32 = b_10;
                let _e619: f32 = c_8;
                let _e622: f32 = res;
                dyS_1 = ((((_e609 + (2f * _e610)) + _e613) - ((_e615 + (2f * _e616)) + _e619)) / (8f * _e622));
                let _e625: f32 = dxS_1;
                let _e626: f32 = cosB_1;
                let _e628: f32 = dyS_1;
                let _e629: f32 = sinB_1;
                dx_4 = ((_e625 * _e626) + (_e628 * _e629));
                let _e632: f32 = dxS_1;
                let _e633: f32 = sinB_1;
                let _e635: f32 = dyS_1;
                let _e636: f32 = cosB_1;
                north_1 = ((_e632 * _e633) - (_e635 * _e636));
                let _e639: f32 = north_1;
                dy_4 = -(_e639);
                colour_1 = vec4<f32>(0f, 0f, 0f, 0f);
                painted = true;
                let _e642: i32 = unnamed.u_style;
                if (_e642 == 2i) {
                    let _e644: f32 = dx_4;
                    let _e645: f32 = dy_4;
                    param_137 = degrees(atan(length(vec2<f32>(_e644, _e645))));
                    let _e650: vec3<f32> = cspSlopeColour_u0028_f1_u003b((&param_137));
                    colour_1 = vec4<f32>(_e650.x, _e650.y, _e650.z, 1f);
                } else {
                    let _e656: i32 = unnamed.u_style;
                    if (_e656 == 3i) {
                        let _e658: f32 = dx_4;
                        let _e659: f32 = dy_4;
                        if (length(vec2<f32>(_e658, _e659)) <= 0.008726868f) {
                            painted = false;
                        } else {
                            let _e663: f32 = dx_4;
                            param_138 = _e663;
                            let _e664: f32 = dy_4;
                            param_139 = _e664;
                            let _e665: f32 = cspAspectOf_u0028_f1_u003b_f1_u003b((&param_138), (&param_139));
                            param_140 = _e665;
                            let _e666: vec3<f32> = cspAspectColour_u0028_f1_u003b((&param_140));
                            colour_1 = vec4<f32>(_e666.x, _e666.y, _e666.z, 1f);
                        }
                    } else {
                        let _e672: i32 = unnamed.u_style;
                        if (_e672 == 4i) {
                            let _e674: f32 = dx_4;
                            let _e675: f32 = dy_4;
                            if (length(vec2<f32>(_e674, _e675)) <= 0.008726868f) {
                                painted = false;
                            } else {
                                let _e679: f32 = dx_4;
                                param_141 = _e679;
                                let _e680: f32 = dy_4;
                                param_142 = _e680;
                                let _e681: f32 = cspAspectOf_u0028_f1_u003b_f1_u003b((&param_141), (&param_142));
                                northness = cos(radians(_e681));
                                let _e684: f32 = northness;
                                amount = abs(_e684);
                                neutral = vec3<f32>(0.96862745f, 0.9529412f, 0.8784314f);
                                let _e686: f32 = northness;
                                target_1 = (select(vec3<f32>(214f, 82f, 78f), vec3<f32>(55f, 137f, 92f), vec3((_e686 >= 0f))) / vec3(255f));
                                let _e692: vec3<f32> = neutral;
                                let _e693: vec3<f32> = target_1;
                                let _e694: f32 = amount;
                                let _e696: vec3<f32> = mix(_e692, _e693, vec3(_e694));
                                colour_1 = vec4<f32>(_e696.x, _e696.y, _e696.z, 1f);
                            }
                        } else {
                            let _e702: i32 = unnamed.u_style;
                            if (_e702 >= 6i) {
                                let _e705: i32 = unnamed.u_style;
                                if (_e705 == 6i) {
                                    local_29 = 2f;
                                } else {
                                    let _e708: i32 = unnamed.u_style;
                                    if (_e708 == 7i) {
                                        local_30 = 5f;
                                    } else {
                                        let _e711: i32 = unnamed.u_style;
                                        local_30 = select(25f, 10f, (_e711 == 8i));
                                    }
                                    let _e714: f32 = local_30;
                                    local_29 = _e714;
                                }
                                let _e715: f32 = local_29;
                                interval_1 = _e715;
                                let _e716: f32 = dx_4;
                                let _e717: f32 = dy_4;
                                let _e720: f32 = res;
                                perPixel_1 = ((length(vec2<f32>(_e716, _e717)) * _e720) * 3.28084f);
                                let _e723: f32 = perPixel_1;
                                if (_e723 > 0f) {
                                    let _e725: f32 = interval_1;
                                    let _e726: f32 = perPixel_1;
                                    spacing_1 = (_e725 / _e726);
                                    let _e728: f32 = spacing_1;
                                    if (_e728 < 3f) {
                                        let _e730: f32 = spacing_1;
                                        if ((_e730 * 5f) >= 3f) {
                                            let _e733: f32 = interval_1;
                                            interval_1 = (_e733 * 5f);
                                        } else {
                                            painted = false;
                                        }
                                    }
                                }
                                let _e735: bool = painted;
                                if _e735 {
                                    let _e736: f32 = value_7;
                                    let _e738: f32 = interval_1;
                                    multiple_1 = ((_e736 * 3.28084f) / _e738);
                                    let _e740: f32 = multiple_1;
                                    let _e741: f32 = multiple_1;
                                    let _e745: f32 = interval_1;
                                    distanceToLine_1 = (abs((_e740 - round(_e741))) * _e745);
                                    let _e747: f32 = interval_1;
                                    let _e749: f32 = perPixel_1;
                                    lineWidth_1 = max(0.35f, min((_e747 * 0.5f), (_e749 * 0.7f)));
                                    let _e753: f32 = distanceToLine_1;
                                    let _e754: f32 = lineWidth_1;
                                    if (_e753 >= _e754) {
                                        painted = false;
                                    } else {
                                        let _e756: f32 = multiple_1;
                                        let _e757: f32 = round(_e756);
                                        indexLine_1 = (abs((_e757 - (floor((_e757 / 5f)) * 5f))) < 0.5f);
                                        let _e764: bool = indexLine_1;
                                        colour_1 = select(vec4<f32>(0.5882353f, 0.43137255f, 0.3137255f, 0.78431374f), vec4<f32>(0.47058824f, 0.27450982f, 0.15686275f, 1f), vec4(_e764));
                                    }
                                }
                            } else {
                                let _e768: i32 = unnamed.u_style;
                                if (_e768 == 5i) {
                                    let _e771: f32 = unnamed.u_ambient;
                                    let _e773: f32 = unnamed.u_ambient;
                                    let _e775: f32 = dx_4;
                                    param_143 = _e775;
                                    let _e776: f32 = dy_4;
                                    param_144 = _e776;
                                    let _e778: f32 = unnamed.u_sunAzimuth;
                                    param_145 = _e778;
                                    let _e779: f32 = cspDirectShade_u0028_f1_u003b_f1_u003b_f1_u003b((&param_143), (&param_144), (&param_145));
                                    shade_1 = (_e771 + ((1f - _e773) * _e779));
                                    let _e782: f32 = value_7;
                                    param_146 = _e782;
                                    let _e783: vec3<f32> = cspTintColour_u0028_f1_u003b((&param_146));
                                    let _e784: f32 = shade_1;
                                    let _e788: vec3<f32> = min((_e783 * (0.33f + (0.82f * _e784))), vec3<f32>(1f, 1f, 1f));
                                    colour_1 = vec4<f32>(_e788.x, _e788.y, _e788.z, 1f);
                                } else {
                                    let _e794: i32 = unnamed.u_style;
                                    if (_e794 == 1i) {
                                        let _e796: f32 = dx_4;
                                        param_147 = _e796;
                                        let _e797: f32 = dy_4;
                                        param_148 = _e797;
                                        let _e798: f32 = cspAspectOf_u0028_f1_u003b_f1_u003b((&param_147), (&param_148));
                                        aspect_1 = _e798;
                                        sum_4 = 0f;
                                        total_1 = 0f;
                                        index_1 = 0i;
                                        loop {
                                            let _e799: i32 = index_1;
                                            if (_e799 < 4i) {
                                                let _e802: f32 = unnamed.u_sunAzimuth;
                                                let _e804: i32 = index_1;
                                                az_2 = ((_e802 - 90f) + (45f * f32(_e804)));
                                                let _e808: f32 = aspect_1;
                                                let _e809: f32 = az_2;
                                                s_6 = sin(radians((_e808 - (_e809 - (floor((_e809 / 360f)) * 360f)))));
                                                let _e817: f32 = dx_4;
                                                let _e818: f32 = dy_4;
                                                if (length(vec2<f32>(_e817, _e818)) < 0.000000000001f) {
                                                    local_31 = 1f;
                                                } else {
                                                    let _e822: f32 = s_6;
                                                    let _e823: f32 = s_6;
                                                    local_31 = (_e822 * _e823);
                                                }
                                                let _e825: f32 = local_31;
                                                weight_1 = _e825;
                                                let _e826: f32 = weight_1;
                                                let _e827: f32 = dx_4;
                                                param_149 = _e827;
                                                let _e828: f32 = dy_4;
                                                param_150 = _e828;
                                                let _e829: f32 = az_2;
                                                param_151 = _e829;
                                                let _e830: f32 = cspDirectShade_u0028_f1_u003b_f1_u003b_f1_u003b((&param_149), (&param_150), (&param_151));
                                                let _e832: f32 = sum_4;
                                                sum_4 = (_e832 + (_e826 * _e830));
                                                let _e834: f32 = weight_1;
                                                let _e835: f32 = total_1;
                                                total_1 = (_e835 + _e834);
                                                continue;
                                            } else {
                                                break;
                                            }
                                            continuing {
                                                let _e837: i32 = index_1;
                                                index_1 = (_e837 + 1i);
                                            }
                                        }
                                        let _e839: f32 = sum_4;
                                        let _e840: f32 = total_1;
                                        direct = (_e839 / max(_e840, 0.00001f));
                                        let _e844: f32 = unnamed.u_ambient;
                                        let _e846: f32 = unnamed.u_ambient;
                                        let _e848: f32 = direct;
                                        shade_2 = (_e844 + ((1f - _e846) * _e848));
                                        let _e851: f32 = shade_2;
                                        let _e852: vec3<f32> = vec3(_e851);
                                        colour_1 = vec4<f32>(_e852.x, _e852.y, _e852.z, 1f);
                                    } else {
                                        let _e857: f32 = dx_4;
                                        param_152 = _e857;
                                        let _e858: f32 = dy_4;
                                        param_153 = _e858;
                                        let _e860: f32 = unnamed.u_sunAzimuth;
                                        param_154 = _e860;
                                        let _e861: f32 = cspDirectShade_u0028_f1_u003b_f1_u003b_f1_u003b((&param_152), (&param_153), (&param_154));
                                        direct_1 = _e861;
                                        let _e863: f32 = unnamed.u_ambient;
                                        let _e865: f32 = unnamed.u_ambient;
                                        let _e867: f32 = direct_1;
                                        shade_3 = (_e863 + ((1f - _e865) * _e867));
                                        let _e870: f32 = shade_3;
                                        let _e871: vec3<f32> = vec3(_e870);
                                        colour_1 = vec4<f32>(_e871.x, _e871.y, _e871.z, 1f);
                                    }
                                }
                            }
                        }
                    }
                }
                let _e876: bool = painted;
                if _e876 {
                    let _e878: f32 = colour_1[3u];
                    if (_e878 > 0f) {
                        let _e880: vec4<f32> = colour_1;
                        param_155 = _e880.xyz;
                        let _e882: vec3<f32> = cspApplyAppearance_u0028_vf3_u003b((&param_155));
                        local_32 = _e882;
                    } else {
                        local_32 = vec3<f32>(0f, 0f, 0f);
                    }
                    let _e883: vec3<f32> = local_32;
                    straight_2 = _e883;
                    let _e884: vec3<f32> = straight_2;
                    let _e886: f32 = colour_1[3u];
                    let _e887: vec3<f32> = (_e884 * _e886);
                    let _e889: f32 = colour_1[3u];
                    let _e895: f32 = unnamed.u_terrainOpacity;
                    terrain = (vec4<f32>(_e887.x, _e887.y, _e887.z, _e889) * _e895);
                }
            }
        }
    }
    let _e897: vec4<f32> = spectrum;
    let _e898: vec4<f32> = terrain;
    let _e900: f32 = spectrum[3u];
    fragColor = (_e897 + (_e898 * (1f - _e900)));
    return;
}

@fragment 
fn main(@location(0) v_screenUv: vec2<f32>) -> @location(0) vec4<f32> {
    v_screenUv_1 = v_screenUv;
    main_1();
    let _e3: vec4<f32> = fragColor;
    return _e3;
}
