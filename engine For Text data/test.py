import Module_five as mf
import Module_six as m6
import Module_seven as m7


folder_path = r"C:\Users\DELL\Downloads\PetImages\Cat"

images = mf.open_images(folder_path)
info = mf.get_information(images, detailed=True)
mf.SaveGraphAndTable(info, "results")
mf.print_report(info)


# m6.clean_and_process(info,images)

folder_path = r"C:\Users\DELL\OneDrive\Desktop\Data Analysis CLI App\cleaned_dataset"

# images = mf.open_images(folder_path)
# info = mf.get_information(images, detailed=True)
# mf.SaveGraphAndTable(info, "result")
# mf.print_report(info)

m7.indicual_labber(images)
m7.indicual_labber(images)
m7.labes_inside_images(images)

