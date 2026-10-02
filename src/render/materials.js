
const default_texture = null;
const default_base_color = [1.0, 0.0, 1.0];  // magenta, used when no texture is provided
const default_shininess = 0.1;


/*---------------------------------------------------------------
	Materials
---------------------------------------------------------------*/
/**
 * Materials are defined by parameters that describe how
 * different objects interact with light.
 *
 * The `properties` array can be used to indicate by
 * which shaders will process this material.
 * ShaderRenderer classes have an `exclude()` function whose
 * behavior can be customized to adapt to different material properties.
 */

class Material {

    constructor(){
        this.texture = default_texture;
        this.color = default_base_color;
        this.shininess = default_shininess;
        this.properties = [];
    }

}

class BackgroundMaterial extends Material {

    constructor({texture = default_texture}){
        super()
        this.texture = texture;
        this.properties.push("environment");
        this.properties.push("no_blinn_phong");
    }
}

class WaterMaterial extends Material {
    constructor({
        texture = null,
        color = default_base_color,
        shininess = default_shininess,
    }){
        super()
        this.properties.push("water");
        this.properties.push("no_blinn_phong");
        this.texture = texture;
        this.color = color;
        this.shininess = shininess;
    }
}

/*---------------------------------------------------------------
	Material Instantiation
---------------------------------------------------------------*/
/**
 * Here materials are defined to later be assigned to objects.
 * Choose the material class, and specify its customizable parameters.
 */
export const overcast_sky = new BackgroundMaterial({
    texture: 'overcast_soil_puresky.jpg'
});

export const water = new WaterMaterial({
    color: [0.025, 0.175, 0.25],
    shininess: 98.
});
