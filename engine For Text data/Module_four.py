import pandas as pd
from sklearn.model_selection import train_test_split

def DatasetSplitter(df, test_size=0.2, validation_size=0.1):
    """
    Splits data into Train, Test, and Validation sets based on percentages of the total dataset.
    Example: test_size=0.2, validation_size=0.1 means Train gets 70%.
    """
    # Step 1: Extract the Test set first
    train_val_data, test_data = train_test_split(df, test_size=test_size, random_state=42)
    
    # Step 2: Extract Validation set from the remaining data.
    # We must adjust the validation ratio relative to the remaining data pool.
    adjusted_val_ratio = validation_size / (1.0 - test_size)
    
    if adjusted_val_ratio > 0:
        train_data, val_data = train_test_split(train_val_data, test_size=adjusted_val_ratio, random_state=42)
    else:
        train_data = train_val_data
        val_data = pd.DataFrame(columns=df.columns)
        
    return train_data, test_data, val_data