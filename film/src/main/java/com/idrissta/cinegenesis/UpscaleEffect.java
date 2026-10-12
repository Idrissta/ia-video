package com.idrissta.cinegenesis;

import android.content.Context;
import android.opengl.GLES20;

import androidx.annotation.OptIn;
import androidx.media3.common.VideoFrameProcessingException;
import androidx.media3.common.util.GlProgram;
import androidx.media3.common.util.GlUtil;
import androidx.media3.common.util.Size;
import androidx.media3.common.util.UnstableApi;
import androidx.media3.effect.BaseGlShaderProgram;
import androidx.media3.effect.GlEffect;
import androidx.media3.effect.GlShaderProgram;

/**
 * Effet GPU d'agrandissement vers la définition de sortie (4K UHD par défaut) :
 * interpolation bicubique Catmull-Rom (9 lectures bilinéaires), puis netteté
 * adaptative au contraste (type CAS) et cadrage sans déformation (bandes noires
 * si le format du clip diffère de celui du film).
 */
@OptIn(markerClass = UnstableApi.class)
final class UpscaleEffect implements GlEffect {

    private static final String VERTEX_GLSL = ""
            + "attribute vec4 aFramePosition;\n"
            + "varying vec2 vTexSamplingCoord;\n"
            + "void main() {\n"
            + "  gl_Position = aFramePosition;\n"
            + "  vTexSamplingCoord = aFramePosition.xy * 0.5 + 0.5;\n"
            + "}\n";

    private static final String FRAGMENT_GLSL = ""
            + "#ifdef GL_FRAGMENT_PRECISION_HIGH\n"
            + "precision highp float;\n"
            + "#else\n"
            + "precision mediump float;\n"
            + "#endif\n"
            + "uniform sampler2D uTexSampler;\n"
            // Taille du clip source en pixels.
            + "uniform vec2 uInSize;\n"
            // Part de l'image de sortie occupée par le clip (1,1 = plein cadre).
            + "uniform vec2 uFit;\n"
            // Force de la netteté, 0 à 1.
            + "uniform float uSharpen;\n"
            + "varying vec2 vTexSamplingCoord;\n"
            + "\n"
            + "vec3 cgTap(vec2 p) {\n"
            + "  return texture2D(uTexSampler, p).rgb;\n"
            + "}\n"
            + "\n"
            // Catmull-Rom 4x4 ramené à 9 lectures en profitant du filtrage bilinéaire.
            + "vec3 cgBicubic(vec2 uv) {\n"
            + "  vec2 pos = uv * uInSize;\n"
            + "  vec2 p1 = floor(pos - 0.5) + 0.5;\n"
            + "  vec2 f = pos - p1;\n"
            + "  vec2 w0 = f * (-0.5 + f * (1.0 - 0.5 * f));\n"
            + "  vec2 w1 = 1.0 + f * f * (-2.5 + 1.5 * f);\n"
            + "  vec2 w2 = f * (0.5 + f * (2.0 - 1.5 * f));\n"
            + "  vec2 w3 = f * f * (-0.5 + 0.5 * f);\n"
            + "  vec2 w12 = w1 + w2;\n"
            + "  vec2 inv = 1.0 / uInSize;\n"
            + "  vec2 t0 = (p1 - 1.0) * inv;\n"
            + "  vec2 t3 = (p1 + 2.0) * inv;\n"
            + "  vec2 t12 = (p1 + w2 / w12) * inv;\n"
            + "  return cgTap(vec2(t0.x, t0.y)) * (w0.x * w0.y)\n"
            + "       + cgTap(vec2(t12.x, t0.y)) * (w12.x * w0.y)\n"
            + "       + cgTap(vec2(t3.x, t0.y)) * (w3.x * w0.y)\n"
            + "       + cgTap(vec2(t0.x, t12.y)) * (w0.x * w12.y)\n"
            + "       + cgTap(vec2(t12.x, t12.y)) * (w12.x * w12.y)\n"
            + "       + cgTap(vec2(t3.x, t12.y)) * (w3.x * w12.y)\n"
            + "       + cgTap(vec2(t0.x, t3.y)) * (w0.x * w3.y)\n"
            + "       + cgTap(vec2(t12.x, t3.y)) * (w12.x * w3.y)\n"
            + "       + cgTap(vec2(t3.x, t3.y)) * (w3.x * w3.y);\n"
            + "}\n"
            + "\n"
            + "void main() {\n"
            + "  vec2 uv = (vTexSamplingCoord - 0.5) / uFit + 0.5;\n"
            + "  if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) {\n"
            + "    gl_FragColor = vec4(0.0, 0.0, 0.0, 1.0);\n"
            + "    return;\n"
            + "  }\n"
            + "  vec3 c = clamp(cgBicubic(uv), 0.0, 1.0);\n"
            // Netteté adaptative : 4 voisins à un texel source, gain limité là où le contraste est déjà fort.
            + "  vec2 px = 1.0 / uInSize;\n"
            + "  vec3 n = cgTap(uv + vec2(0.0, px.y));\n"
            + "  vec3 s = cgTap(uv - vec2(0.0, px.y));\n"
            + "  vec3 e = cgTap(uv + vec2(px.x, 0.0));\n"
            + "  vec3 w = cgTap(uv - vec2(px.x, 0.0));\n"
            + "  vec3 mn = min(c, min(min(n, s), min(e, w)));\n"
            + "  vec3 mx = max(c, max(max(n, s), max(e, w)));\n"
            + "  vec3 amp = sqrt(clamp(min(mn, 1.0 - mx) / max(mx, vec3(0.0001)), 0.0, 1.0));\n"
            + "  vec3 wt = -amp * (0.2 * clamp(uSharpen, 0.0, 1.0));\n"
            + "  vec3 sharp = (c + (n + s + e + w) * wt) / (1.0 + 4.0 * wt);\n"
            // Anti-halo : le résultat reste dans l'étendue locale des couleurs.
            + "  gl_FragColor = vec4(clamp(sharp, mn, mx), 1.0);\n"
            + "}\n";

    private final int width;
    private final int height;
    private final float sharpen;

    /**
     * @param width   largeur de sortie en pixels (paire)
     * @param height  hauteur de sortie en pixels (paire)
     * @param sharpen force de la netteté, de 0 (aucune) à 1
     */
    UpscaleEffect(int width, int height, float sharpen) {
        this.width = Math.max(2, width & ~1);
        this.height = Math.max(2, height & ~1);
        this.sharpen = Float.isNaN(sharpen) ? 0f : Math.max(0f, Math.min(1f, sharpen));
    }

    @Override
    public GlShaderProgram toGlShaderProgram(Context context, boolean useHdr) throws VideoFrameProcessingException {
        return new Program(useHdr, width, height, sharpen);
    }

    @Override
    public boolean isNoOp(int inputWidth, int inputHeight) {
        // Clip déjà à la bonne taille et sans netteté : rien à faire.
        return inputWidth == width && inputHeight == height && sharpen <= 0f;
    }

    /** Programme GL : une passe, une texture de sortie. */
    private static final class Program extends BaseGlShaderProgram {
        private final GlProgram glProgram;
        private final int outWidth;
        private final int outHeight;
        private final float sharpen;
        private final float[] inSize = {1f, 1f};
        private final float[] fit = {1f, 1f};

        Program(boolean useHdr, int outWidth, int outHeight, float sharpen) throws VideoFrameProcessingException {
            super(useHdr, /* texturePoolCapacity= */ 1);
            this.outWidth = outWidth;
            this.outHeight = outHeight;
            this.sharpen = sharpen;
            try {
                glProgram = new GlProgram(VERTEX_GLSL, FRAGMENT_GLSL);
            } catch (GlUtil.GlException e) {
                throw new VideoFrameProcessingException(e);
            }
            glProgram.setBufferAttribute("aFramePosition", GlUtil.getNormalizedCoordinateBounds(),
                    GlUtil.HOMOGENEOUS_COORDINATE_VECTOR_SIZE);
        }

        @Override
        public Size configure(int inputWidth, int inputHeight) throws VideoFrameProcessingException {
            if (inputWidth <= 0 || inputHeight <= 0) {
                throw new VideoFrameProcessingException("Taille d'image invalide : " + inputWidth + "×" + inputHeight);
            }
            inSize[0] = inputWidth;
            inSize[1] = inputHeight;
            // Cadrage « contenir » : le clip entier reste visible, centré.
            float scale = Math.min((float) outWidth / inputWidth, (float) outHeight / inputHeight);
            float fx = inputWidth * scale / outWidth;
            float fy = inputHeight * scale / outHeight;
            // Écart de format inférieur à 1 % : on remplit le cadre plutôt que de laisser un liseré noir.
            fit[0] = fx > 0.99f ? 1f : fx;
            fit[1] = fy > 0.99f ? 1f : fy;
            return new Size(outWidth, outHeight);
        }

        @Override
        public void drawFrame(int inputTexId, long presentationTimeUs) throws VideoFrameProcessingException {
            try {
                glProgram.use();
                glProgram.setSamplerTexIdUniform("uTexSampler", inputTexId, /* texUnitIndex= */ 0);
                glProgram.setFloatsUniform("uInSize", inSize);
                glProgram.setFloatsUniform("uFit", fit);
                glProgram.setFloatUniform("uSharpen", sharpen);
                glProgram.bindAttributesAndUniforms();
                GLES20.glDrawArrays(GLES20.GL_TRIANGLE_STRIP, /* first= */ 0, /* count= */ 4);
                GlUtil.checkGlError();
            } catch (GlUtil.GlException e) {
                throw new VideoFrameProcessingException(e, presentationTimeUs);
            }
        }

        @Override
        public void release() throws VideoFrameProcessingException {
            try {
                super.release();
            } finally {
                try {
                    glProgram.delete();
                } catch (GlUtil.GlException e) {
                    throw new VideoFrameProcessingException(e);
                }
            }
        }
    }
}
